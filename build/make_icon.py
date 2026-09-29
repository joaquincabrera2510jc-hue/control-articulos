# Arma build/icon.ico a partir del logo (src/logo.png): "LÓPEZ" arriba y "MOTORS" abajo, sobre fondo negro.
# Lo ejecuta GitHub Actions antes de armar el instalador.
from PIL import Image, ImageDraw
import os

aqui = os.path.dirname(os.path.abspath(__file__))
logo = Image.open(os.path.join(aqui, "..", "src", "logo.png")).convert("RGBA")
alpha = logo.getchannel("A")
w, h = logo.size
cols = [sum(1 for y in range(h) if alpha.getpixel((x, y)) > 60) for x in range(w)]

# el hueco más ancho entre "LÓPEZ" y "MOTORS" (en la zona central del logo)
mejor, ini = (0, 0, 0), None
for x in range(int(w * 0.3), int(w * 0.6)):
    if cols[x] == 0 and ini is None:
        ini = x
    if cols[x] != 0 and ini is not None:
        if x - ini > mejor[0]:
            mejor = (x - ini, ini, x)
        ini = None
corte = (mejor[1] + mejor[2]) // 2 if mejor[0] else int(w * 0.45)

def recorte(img):
    return img.crop(img.getchannel("A").point(lambda v: 255 if v > 60 else 0).getbbox())

lopez = recorte(logo.crop((0, 0, corte, h)))
motors = recorte(logo.crop((corte, 0, w, h)))

S = 1024
icono = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ImageDraw.Draw(icono).rounded_rectangle((0, 0, S - 1, S - 1), radius=190, fill=(11, 12, 13, 255))

def pegar(img, ancho, y):
    alto = int(img.height * ancho / img.width)
    r = img.resize((ancho, alto), Image.LANCZOS)
    icono.alpha_composite(r, ((S - ancho) // 2, y))
    return alto

alto1 = int(lopez.height * 860 / lopez.width)
alto2 = int(motors.height * 700 / motors.width)
y = (S - (alto1 + 50 + alto2)) // 2
pegar(lopez, 860, y)
pegar(motors, 700, y + alto1 + 50)

icono.save(os.path.join(aqui, "icon.ico"), sizes=[(256, 256), (64, 64), (48, 48), (32, 32), (16, 16)])
icono.resize((256, 256), Image.LANCZOS).save(os.path.join(aqui, "icon.png"))
print("icon.ico listo, corte en x =", corte)
