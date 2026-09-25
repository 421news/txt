# txt

Un foro de **solo texto**, pseudoanónimo y moderado. Lo hace [421](https://www.421.news) y funciona en **[txt.421.news](https://txt.421.news)**.

Sin imágenes, sin likes, sin seguidores, sin algoritmo. Las publicaciones se ordenan por la última respuesta y ya.

## Cómo es

- **Solo texto.** Sin imágenes, videos ni links clickeables. Saca de raíz el material de abuso y hace que lo importante sea lo que se escribe.
- **Pseudoanónimo.** Se entra con una cuenta de Google, pero nadie la ve: en cada publicación aparecés con un ID distinto. La cuenta existe para poder suspender a quien no respete las normas. No se guarda el correo.
- **Moderado antes de publicar.** Cada mensaje pasa por un filtro con [Claude](https://www.anthropic.com/claude) antes de aparecer. Si tiene dudas, lo mira una persona. Además, cualquiera puede reportar y hay moderadores.
- **Tolerancia cero** con el abuso infantil, el abuso sexual y la violencia explícita: la cuenta se suspende en el acto.
- **Casi sin JavaScript.** Un solo script propio, que actualiza las publicaciones en vivo. Sin él, el sitio funciona igual.
- **También en texto plano y en Gemini.** Cualquier página se puede leer como `.txt` (y con `curl`), y hay una cápsula Gemini de solo lectura.

Las normas completas están en [txt.421.news/normas](https://txt.421.news/normas).

## Cómo está hecho

Node 20 · Express 5 · SQLite (`better-sqlite3`) · HTML armado en el servidor · SDK de Anthropic.

| Archivo | Qué hace |
|---|---|
| `src/app.js` | Rutas, sesiones, CSRF, límites, publicación y moderación. Recibe la base, el moderador y el reloj inyectados, así se testea sin red. |
| `src/moderation.js` | El filtro con Claude: prompt, criterios y veredicto (`approve` / `queue` / `reject`, más los casos graves). |
| `src/normas.js` | Las normas. Las usan la página `/normas`, el filtro y el menú de reportes. |
| `src/views.js` · `src/html.js` | Plantillas HTML con escape automático. |
| `src/format.js` | Texto de un mensaje a HTML: `>cita`, `>>123` y `[spoiler]`. Escapa todo primero. |
| `src/documentos.js` | Las páginas de lectura como documentos neutros, que se escriben en texto plano o en gemtext. |
| `src/gemini.js` | La cápsula Gemini de solo lectura. |
| `src/google.js` | Login con Google (OAuth con PKCE), sin librerías. |
| `public/` | CSS, el único script (`vivo.js`) e íconos. |

## Correrlo en tu máquina

```sh
npm install
cp .env.example .env      # completá lo que haga falta
npm run dev               # http://localhost:3000
npm test
```

Sin credenciales de Google, en desarrollo `/entrar` ofrece un **acceso de prueba** (un nombre cualquiera y una casilla de admin). Sin `ANTHROPIC_API_KEY`, todos los mensajes van a revisión humana: el filtro falla cerrado. `npm run probar-moderacion` corre el filtro real contra casos de prueba (gasta API).

## Contribuir

Se aceptan pull requests. Antes, leé [CONTRIBUTING.md](CONTRIBUTING.md): ahí está qué cosas no se van a sumar aunque estén bien hechas.

## Licencia

[GNU Affero General Public License v3.0](LICENSE). Podés usar, estudiar, modificar y compartir txt. Si lo modificás y lo ofrecés como servicio en internet, tenés que ofrecerles a tus usuarios el código con tus cambios, bajo la misma licencia.
