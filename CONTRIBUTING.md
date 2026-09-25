# Cómo contribuir a txt

Gracias por querer sumar. Se aceptan pull requests: arreglos, mejoras de accesibilidad, rendimiento, textos, tests. Esta guía es corta a propósito.

## Antes de escribir código

- **Si es un arreglo chico**, mandá el PR directo.
- **Si es algo nuevo o grande**, abrí primero un *issue* contando la idea. Así no invertís horas en algo que después no entra.

## Qué no se va a sumar

txt tiene principios que no se negocian. Estos PRs se van a cerrar aunque estén bien hechos:

- Likes, votos, contadores de seguidores, rankings o cualquier cosa que convierta la conversación en competencia.
- Algoritmos de recomendación u orden "por relevancia". El orden es por última respuesta.
- Imágenes, video o links clickeables en los mensajes.
- Analytics, píxeles, scripts o fuentes de terceros, o cualquier forma de rastreo.
- Más JavaScript en el cliente del necesario. El sitio tiene que funcionar sin él.
- Cambios que aflojen la tolerancia cero con el abuso infantil, el abuso sexual o la violencia explícita.
- Cambios que expongan datos de los usuarios o debiliten el pseudoanonimato.

## Cómo tiene que venir un PR

1. **Que pasen los tests** (`npm test`) y que lo nuevo tenga su test. Los tests no usan red ni API: Google y Claude van simulados.
2. **Un cambio por PR**, con una descripción de qué hace y por qué.
3. **El estilo del código de alrededor**: ES modules, sin dependencias nuevas salvo que hagan falta de verdad, y nombres y comentarios en castellano, como el resto.
4. **Todo lo que se muestra se escapa.** El HTML se arma con `html```, que escapa solo; `raw()` es solo para lo que ya es seguro.
5. **Si tocás la moderación** (`src/moderation.js` o `src/normas.js`), contá qué casos cambian. Si podés, sumá casos a `scripts/probar-moderacion.js`.

## Qué pasa después

Cada PR lo revisa una persona del equipo antes de entrar. Aceptar un PR no lo publica en el sitio: el despliegue lo hacemos nosotros, aparte.

## Seguridad

Si encontrás una vulnerabilidad, **no abras un issue público**: escribí a admin@421.news.

## Licencia

Al mandar un PR aceptás que tu contribución se publique bajo la misma licencia del proyecto, la [AGPLv3](LICENSE).
