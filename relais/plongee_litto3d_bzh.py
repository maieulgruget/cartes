#!/usr/bin/env python3
"""Litto3D® Bretagne 2018-2021 (Shom, IGN, Région Bretagne ; Licence Ouverte) : rapatrie le modèle à 5 m des dalles
qui couvrent la baie de Saint-Brieuc, pour relais/plongee_fonds.py --secteur=baie.

Le Shom diffuse ce Litto3D par paquets 7z de 5 km de côté (37 Go pour ces quarante paquets), qui contiennent le
nuage de points, le modèle à 1 m et le modèle à 5 m. Seul ce dernier sert ici : l'archive est lue à distance par
requêtes partielles (en-tête Range), et seuls les blocs des fichiers MNT5m sont téléchargés, soit 2,5 Go environ.

Usage : python3 relais/plongee_litto3d_bzh.py <dossier de données>
        (écrit <dossier>/bzh/asc/... ; un paquet déjà fait n'est pas repris)
Dépendance : py7zr.
"""
import concurrent.futures as cf
import io
import os
import sys
import time
import urllib.request

import py7zr

# Paquets (coin sud-ouest en km, Lambert 93) qui touchent l'emprise du secteur « baie ». Pour un autre secteur breton,
# la liste des paquets se lit dans le catalogue de diffusion du Shom (produit LITTO3D_BZH_2018_2021).
PACKS = """
    0265_6855 0280_6850 0295_6860 0270_6855 0280_6855 0290_6860 0290_6865 0280_6865 0265_6860 0275_6855
    0280_6840 0290_6845 0280_6860 0285_6850 0285_6840 0295_6855 0285_6860 0270_6865 0300_6850 0275_6865
    0295_6850 0270_6850 0270_6845 0300_6860 0270_6840 0290_6850 0275_6840 0265_6850 0275_6860 0275_6850
    0265_6865 0290_6855 0300_6845 0285_6865 0270_6860 0285_6855 0285_6845 0280_6845 0300_6855 0275_6845
""".split()
URL = 'https://services.data.shom.fr/INSPIRE/telechargement/prepackageGroup/LITTO3D_BZH_2018_2021_PACK_DL/prepackage/{0}/file/{0}.7z'


class FichierDistant(io.RawIOBase):
    def __init__(self, url, bloc=2 << 20):
        self.url, self.bloc, self.pos, self.cache, self.lus = url, bloc, 0, {}, 0
        r = urllib.request.Request(url, headers={'Range': 'bytes=0-0'})
        with urllib.request.urlopen(r, timeout=120) as f:
            self.taille = int(f.headers['Content-Range'].split('/')[1])
    def seekable(self): return True
    def readable(self): return True
    def tell(self): return self.pos
    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.taille + off
        return self.pos
    def _bloc(self, i, n=1):
        # Lit n blocs d'un coup à partir du bloc i (lecture séquentielle anticipée).
        a, b = i * self.bloc, min(self.taille, (i + n) * self.bloc) - 1
        for essai in range(5):
            try:
                r = urllib.request.Request(self.url, headers={'Range': f'bytes={a}-{b}'})
                with urllib.request.urlopen(r, timeout=300) as f:
                    d = f.read()
                break
            except Exception:
                if essai == 4: raise
                time.sleep(2 + essai * 3)
        self.lus += len(d)
        for k in range(n):
            self.cache[i + k] = d[k * self.bloc:(k + 1) * self.bloc]
        if len(self.cache) > 64:
            for k in sorted(self.cache)[: len(self.cache) - 64]:
                if k < i: del self.cache[k]
    def read(self, n=-1):
        if n is None or n < 0: n = self.taille - self.pos
        n = min(n, self.taille - self.pos); out = bytearray()
        while n > 0:
            i, o = divmod(self.pos, self.bloc)
            if i not in self.cache:
                # Une grosse lecture : on demande tout ce qu'il faut en une requête.
                # Lecture qui se poursuit : on prend de l'avance (16 Mo), une requête coûte plus par son attente que par son poids.
                self._bloc(i, 8 if (i - 1) in self.cache else max(1, min(16, (o + n + self.bloc - 1) // self.bloc)))
            d = self.cache[i][o:o + n]
            out += d; self.pos += len(d); n -= len(d)
        return bytes(out)
    def readinto(self, b):
        d = self.read(len(b)); b[:len(d)] = d; return len(d)


def un(p, sortie):
    fait = os.path.join(sortie, p + '.fait')
    if os.path.exists(fait):
        return p, 0, 0
    err = ''
    for essai in range(3):
        try:
            t = time.time(); f = FichierDistant(URL.format(p)); z = py7zr.SevenZipFile(f)
            cibles = [n for n in z.getnames() if n.endswith('.asc') and '/MNT5m/' in n]
            z.extract(path=sortie, targets=cibles)
            open(fait, 'w').write(str(len(cibles)))
            return p, f.lus, time.time() - t
        except Exception as e:
            err = e; time.sleep(5)
    return p, -1, str(err)[:200]


if __name__ == '__main__':
    sortie = os.path.join(sys.argv[1], 'bzh', 'asc'); os.makedirs(sortie, exist_ok=True)
    with cf.ThreadPoolExecutor(5) as ex:
        for p, lus, t in ex.map(lambda p: un(p, sortie), PACKS):
            print(p, f'{round(lus / 1e6)} Mo' if lus >= 0 else 'ÉCHEC', t if isinstance(t, str) else f'{round(t)} s', flush=True)
