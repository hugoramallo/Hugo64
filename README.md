# Cragspire Mountain

Juego de plataformas 3D para el navegador, inspirado en los mundos abiertos de los plataformas clásicos de 64 bits. Está hecho con **three.js r186** (WebGPU y TSL), con cambio automático a WebGL 2 si el navegador no admite WebGPU.

Todo es original: modelos procedurales, texturas, música y efectos de sonido.

## Cómo jugar

Hace falta conexión a Internet, porque three.js y las fuentes se cargan desde CDN. Sirve la carpeta con cualquier servidor estático:

```bash
python3 -m http.server 8000
```

Abre `http://localhost:8000` en Chrome, Edge o Safari. Para forzar el modo WebGL 2, usa `http://localhost:8000/#webgl`.

## Controles

| Acción | Teclado | Mando |
| --- | --- | --- |
| Mover | W A S D | Stick izquierdo |
| Correr | Shift (mantener) | RT, B o RB |
| Saltar / doble salto | Espacio / Espacio en el aire | A |
| Agacharse (en el aire: planchazo) | C | LT o LB |
| Puñetazo / patada | J o clic | X |
| Agarrar, lanzar, trepar | E | Y |
| Cámara | Ratón, Q/← y → | Stick derecho |
| Recolocar la cámara | Tab | Pulsar un stick |
| Pausa | Esc o P | Start |

Movimientos avanzados:
- **Salto largo:** correr + C + Espacio.
- **Voltereta hacia atrás:** quieto + C + Espacio.
- **Salto lateral:** cambiar de dirección corriendo + Espacio.
- **Rebote en pared:** saltar contra una pared y pulsar Espacio.

Al Crag King, el jefe final, solo le hacen daño las rocas lanzadas. Con 5 impactos cae.

## Gráficos y rendimiento

- **Reescalado temporal (TAAU):** la escena se dibuja a menor resolución y se reconstruye a la resolución nativa, con nitidez adaptativa (CAS).
- **Iluminación:**
  - Sombras en cascada con actualización escalonada.
  - Oclusión ambiental (GTAO), rayos de sol y brillo en las luces intensas.
  - Neblina atmosférica y follaje translúcido.
- **Sin compilación en partida:** todos los shaders se preparan durante la carga.
- **Calidad adaptativa:** se calibra en la pantalla de título. En la pausa se elige la calidad (Auto, Ultra, High, Medium, Low) y la tasa de fotogramas (Auto, 60, 30, Max). En Auto, las pantallas de 120 Hz van a 60 fps constantes salvo que el equipo vaya sobrado.
- **WebGL 2:** usa una versión más sencilla del posprocesado.

## Estructura

| Archivo | Contenido |
| --- | --- |
| `index.html` | Página, interfaz, ajustes y arranque (import map de three.js) |
| `js/gfx.js` | Render: cielo, sombras, terreno, agua, follaje, posprocesado, calidad adaptativa, precompilación de shaders |
| `js/game.js` | Bucle principal con control del ritmo de fotogramas, estados, reinicio y victoria |
| `js/player.js`, `js/player_model.js` | Control del protagonista, y su modelo y animación procedural |
| `js/terrain.js`, `js/physics.js` | Terreno, masas de agua y colisiones |
| `js/castle.js`, `js/level.js`, `js/decor.js`, `js/water.js` | El castillo, el diseño del nivel, la vegetación y el agua |
| `js/enemy_base.js`, `js/enemy_types.js`, `js/boss.js` | Enemigos y jefe final |
| `js/collectibles.js`, `js/interactive.js` | Monedas, gemas y objetos interactivos |
| `js/audio.js`, `js/music.js` | Sonido y banda sonora sintetizados con WebAudio |
| `js/hud.js`, `js/fx.js`, `js/core.js`, `js/camera.js`, `js/materials.js` | Interfaz, efectos, entrada, cámara y materiales |
| `tools/harness.js` | Utilidades de prueba para la consola del navegador (solo desarrollo) |
