# WHATSAPP

Gestor de cuentas autorizadas: página móvil de vinculación y panel interno en Telegram. Sin IA. Conexión no oficial mediante WhatsApp Web; no se garantiza permanencia de la sesión ni ausencia de restricciones de WhatsApp.

## Puesta en marcha

Desplegar `render.yaml` como Blueprint en Render. Servicio `WHATSAPP`, Docker, Virginia, 1 CPU / 2 GB, disco de 1 GB. Una sola instancia: cada sesión y SQLite pertenecen al disco persistente. No desplegar copias del mismo bot ni montar las mismas sesiones en dos procesos. Los despliegues con disco causan una interrupción breve; el dueño puede necesitar vincular nuevamente si WhatsApp revoca su sesión.

Variables requeridas:

| Variable | Contenido |
| --- | --- |
| `TOKEN` | Token del bot de administración de Telegram, configurado como secreto en Render |
| `ALMACEN` | Grupo de destino de los archivos descargados: `-1004466212290`; el bot debe poder enviar documentos |
| `ADMIN_IDS` | Opcional: IDs adicionales separados por coma. La lista principal está en `admins.txt` |
| `CHATS` | Grupo de mensajes entrantes: `-1004461387155`; prevalece sobre `ADMIN_CHAT_ID` |
| `ADMIN_CHAT_ID` | Compatibilidad: destino de mensajes si no se configura `CHATS` |
| `PUBLIC_URL` | Opcional: URL pública HTTPS; se usa `RENDER_EXTERNAL_URL` si se omite |
| `DATA_DIR` | `/var/data/whatsapp`, dentro del disco montado en `/var/data`. El inicio prepara los permisos de esa subcarpeta y ejecuta Node/Chromium con el usuario `node`, sin privilegios |
| `MAX_ACCOUNTS` | Variable antigua: ya no se utiliza. No hay límite programado de cuentas; la capacidad depende de los recursos del servidor. |
| `MAX_MEDIA_MB` | Máximo por archivo descargado: 20 MB por defecto |

La página inicia sin secretos para permitir verificar el diseño, pero rechaza vincular cuentas mientras falten el bot, el panel o administradores. Los operadores se declaran en `admins.txt`, un ID numérico por línea; incluye al propietario `7539025033`. El Dockerfile incorpora el archivo al servicio. Nunca guardar tokens ni sesiones en GitHub.

## Operación

1. El titular abre la URL pública y pulsa **CONECTAR CUENTA**. Introduce su número y acepta la autorización. El sistema crea un acceso de navegador sin enlace de invitación. La confirmación de la cuenta se hace dentro de WhatsApp. El operador también puede usar `/invitar +NUMERO Nombre` para altas asistidas.
2. Solo en el alta asistida se genera un enlace privado con fragmento, de un solo uso y válido 24 h. Enviarlo únicamente al titular de la cuenta. Al abrirlo se intercambia por una cookie HttpOnly; el fragmento se elimina del navegador.
3. El titular confirma su número y autoriza explícitamente la lectura, respuestas y manejo de archivos. El servidor muestra un código de vinculación que se introduce **dentro de WhatsApp**. Nunca solicitar códigos de registro SMS ni PIN. El código no se envía al panel.
4. El servidor verifica que la cuenta vinculada corresponde al número invitado. Recibe mensajes privados nuevos y los lleva al panel autorizado. La recepción automática no importa historiales anteriores ni mensajes de grupos, estados o enviados por el propio titular. El menú permite consultar a petición el historial privado que WhatsApp entregue.
5. Un operador responde al mensaje de CHATS con texto, foto, video, documento, audio o nota de voz; se envía desde la cuenta WhatsApp correspondiente. Los registros de rutas persisten entre reinicios. Las respuestas que WhatsApp acepta se consideran enviadas, no necesariamente entregadas al destinatario.
6. `/regla ID frase | respuesta` configura respuestas de coincidencia exacta y sin IA; `/reglas ID`, `/borrarregla NUMERO` las administran.
7. `/pausar ID`, `/activar ID`, `/reconectar ID`, `/desconectar ID` controlan la cuenta. Desconectar requiere confirmar. El titular también puede pausar y revocar desde su página o desde Dispositivos vinculados de WhatsApp.
8. `🎨 EDITAR PÁGINA` permite cambiar logo, título, descripción, botón y color. La autorización no es editable. Vista previa: la URL pública; los textos se insertan como texto, nunca como HTML.

El bot solo admite administradores declarados, en su DM o el panel configurado. En un grupo panel, todos sus miembros pueden ver el contenido; el dueño debe controlar su membresía. No compartir el panel con clientes distintos.

## Archivos, límites y recuperación

Fotos, videos y documentos recibidos se descargan si WhatsApp proporciona un tamaño válido bajo el límite configurado. Los medios efímeros y de visualización única no se archivan. Los archivos demasiado grandes o no disponibles se notifican y no se descargan. En las descargas manuales, un tamaño desconocido se verifica después de recuperar el archivo; el fallo de un archivo no detiene los demás. Los archivos se guardan en el disco y se envían como documentos a Telegram; Telegram puede impedir determinadas transferencias. No se descargan archivos mayores a 20 MB desde el bot de Telegram para responder.

Los archivos locales y el texto de la bandeja se eliminan después de 7 días, con mantenimiento cada hora. Las copias enviadas a Telegram tienen retención independiente y no se borran automáticamente. Auditoría sin contenido: 90 días; rutas: últimas 10.000. Sesiones y datos de cuentas persisten mientras se mantenga el servicio. La pausa no recupera automáticamente los mensajes recibidos durante la pausa.

Cada cuenta procesa mensajes en orden, con límite de cola 200. Si se llena, se pausa y se avisa. La bandeja registra mensajes procesados por ID para no ejecutar dos veces la misma entrada. Un fallo incierto se marca para revisión con `/pendientes`; no se reenvía automáticamente un mensaje que podría haberse enviado. Tras un reinicio, los registros `processing` también requieren revisión manual. No existe garantía de entrega exactamente una vez, de recuperación de todos los mensajes perdidos durante desconexiones ni de capacidad para alto volumen sin prueba real.

## Validación

Node 24. `npm install`, `npm run check`, `npm test`. Docker incluye Chromium; para ejecución local se debe disponer de Chrome/Chromium. `npm start` escucha en `0.0.0.0:$PORT`; `/health` verifica el servicio HTTP. Una comprobación HTTP correcta no verifica WhatsApp ni Telegram: hace falta prueba de aceptación con una cuenta del titular y el bot configurado.

La prueba de aceptación debe cubrir vinculación en iPhone/Android, envío y recepción de texto/foto/video/documento, respuesta desde Telegram, aislamiento entre dos cuentas, pausa, revocación, reinicio con disco, desconexión y carga sostenida antes de admitir clientes del contrato.


## Menú privado y grupos de destino

Los administradores abren `/menu` en el privado del bot. La lista informa cuántas cuentas están conectadas según las sesiones activas; muestra nombre de WhatsApp, teléfono completo con enlace wa.me y país del plan de numeración, no ubicación física. Si WhatsApp solo revela un LID y no permite resolver su número, se muestra «número no disponible», sin fabricar un enlace.

Seleccionar una cuenta por botón o número abre la ficha con foto (si está accesible), chats privados disponibles, abiertos (sin archivar), chats con candado visibles y contactos bloqueados. CHATS abre la lista paginada de contactos; seleccionar uno abre su ficha con conteos del índice multimedia de WhatsApp Web, consultado directamente por conversación. No se cuentan solo los últimos 500 mensajes. El índice pertenece al dispositivo vinculado y puede diferir de la galería local del teléfono. Al alcanzar el límite de seguridad de 20.000 entradas del índice, el resultado se indica como parcial. El ranking consulta ese mismo índice. Los chats ocultos o no sincronizados pueden faltar.

- SINCRONIZAR GALERÍA solicita ampliar el historial mediante syncHistory cuando WhatsApp lo permite. Solicitud aceptada no significa sincronización completada ni garantiza igualar la galería del teléfono. ACTUALIZAR GALERÍA vuelve a consultar el índice.
- RESPONDER mantiene activo el contacto elegido durante cinco minutos desde el último envío. Permite mandar texto y luego una foto sin pulsar otra vez el botón. Cambiar de menú, responder por reply o usar /cancelar cierra ese destinatario. Permite texto, fotos, videos, documentos y audio. Una nota de voz de Telegram se envía con sendAudioAsVoice. `/cancelar` cancela.
- VER MENSAJES muestra hasta diez mensajes recibidos entre los últimos cincuenta disponibles y crea rutas persistentes para contestarlos por reply.
- BORRAR ÚLTIMO MENSAJE muestra el último enviado por esa cuenta en ese chat. Requiere confirmar ese ID exacto y comprobar que WhatsApp permite revocarlo para todos. No borra mensajes entrantes ni cae silenciosamente en borrado local. El resultado se informa como solicitud enviada, no garantía de borrado en todos los dispositivos.
- DESCARGAR 10 / FOTOS 10 / VIDEOS 10 envían hasta diez archivos nuevos del historial consultado, más recientes primero. Excluyen visualización única, efímeros, medios sin tamaño seguro o mayores a MAX_MEDIA_MB. El registro persistente media_exports evita repetir archivos ya enviados. Una entrega incierta queda para revisión y no se reintenta automáticamente; aparece en `/pendientes`.

La variable CHATS se administra en el servicio Render. ALMACEN sigue siendo -1004466212290. Los menús se operan en privado; las respuestas por reply se admiten en CHATS, ALMACEN y en los mensajes con ruta del privado. Los avisos entrantes identifican emisor y receptor con enlaces cuando se conocen los teléfonos. Los audios recibidos se publican en CHATS; fotos, videos y documentos se archivan en ALMACEN. El bot debe estar añadido a ambos grupos y poder enviar mensajes/archivos.

Las botoneras y la composición están aisladas por administrador y chat; los botones vencen a los treinta minutos. Las rutas de reply, perfiles y marcas de descarga persisten en SQLite. Ninguna prueba automatizada sustituye la prueba real de enviar texto, foto, video y audio desde otra cuenta, recibirlos en sus destinos y responder desde el bot.

## Guías de vinculación Android / iPhone

La web muestra una elección de dispositivo y una guía con SIGUIENTE / ATRÁS. El primer paso explica cómo generar el código en la página. La guía se puede recorrer antes de vincular, sin introducir un número ni aceptar la autorización. Los demás pasos explican dónde autorizarlo dentro de WhatsApp. Las ilustraciones SVG animadas son orientativas, no capturas oficiales. Se generan con `python scripts/build-guide-art.py`. Instrucciones contrastadas con https://faq.whatsapp.com/1324084875126592/ (consultado el 22 de octubre de 2026).

En el privado del bot: `/menu` → EDITAR PÁGINA → GUÍAS ANDROID / IPHONE → dispositivo → paso. Se pueden editar título e instrucciones, reemplazar imagen/GIF/MP4, añadir hasta diez pasos, reordenarlos y quitarlos. Los cambios quedan en SQLite y los medios en DATA_DIR/guide-media, dentro del disco persistente. Se admiten PNG, JPG, WebP, GIF y MP4 hasta 8 MB; los GIF que Telegram convierte a MP4 también funcionan. No se admiten HTML ni SVG subidos por operadores. Los medios de la guía son públicos, por lo que deben contener solamente instrucciones y ejemplos sin datos privados. Las nuevas versiones se ven al recargar la página y no requieren otro despliegue. Las imágenes reemplazadas sin referencias se limpian después de 24 horas.

`npm test` cubre aislamiento de guías, edición autorizada, formatos, persistencia y servicio de recursos. `node scripts/verify-guide-ui.mjs` ofrece una comprobación adicional con Chromium cuando el entorno permite ejecutarlo; simula las respuestas de vinculación y no conecta una cuenta real.

## Recuperación de sesiones después de actualizar

La lista de Telegram distingue una sesión lista de una que está conectando, requiere nueva vinculación o falló al arrancar. Una entrada en Dispositivos vinculados del teléfono no prueba que el proceso del servidor esté activo. La ficha de una cuenta inactiva ofrece RECUPERAR CONEXIÓN sin revocar al titular.

El arranque elimina únicamente los enlaces SingletonLock/Cookie/Socket de Chromium cuyo propietario corresponde a otro host o a un proceso local inexistente, dentro del modelo de un único servicio con disco exclusivo. Conserva cookies, IndexedDB y credenciales. No libera un bloqueo local activo. Los fallos de conexión se clasifican sin registrar el texto privado del error y quedan en /pendientes. El inicio registra restore_started, authenticated, syncing y ready; la disponibilidad HTTP no implica una conexión WhatsApp lista. Tini se ejecuta después de bajar al usuario node, para reenviar señales de cierre al mismo UID.

## Compatibilidad de identificadores WhatsApp Web

La dependencia permanece fijada en whatsapp-web.js 1.34.7. `postinstall` ejecuta scripts/patch-whatsapp.cjs antes de arrancar; Docker copia ese instalador antes de npm ci. El puente acepta identificadores antiguos _serialized y nuevos $1 para consultas de chats, últimas entradas, serialización de mensajes y resultados de envío. No descarga ni ejecuta forks de terceros. Verifica la versión y el hash del archivo original, falla si cambia la dependencia sin revisión y es idempotente.

Referencias del proyecto original: https://github.com/wwebjs/whatsapp-web.js/pull/201850 y https://github.com/wwebjs/whatsapp-web.js/pull/201910. Cada chat se consulta de forma aislada; los errores se cuentan y Telegram avisa explícitamente cuando la lista es parcial. Si todos los chats fallan, la ficha sigue accesible con «No disponible», sin inventar ceros. Al recuperar la conexión se realiza una consulta de chats de solo lectura, registrando exclusivamente cantidad recuperada y fallos. Las pruebas ejecutan el LoadUtils real contra modelos simulados de ambos formatos y contra errores de lectura.

Compatibilidad multimedia: el instalador verifica el código original de whatsapp-web.js 1.34.7 antes de aplicar el envío de mimetype a DownloadManager y eliminar el campo privado __x_id del mensaje saliente. Referencias: issues upstream 201908 y PR 201923. Los fallos de Telegram conservan método y código HTTP; los envíos de resultado incierto se mantienen para revisión sin reenvío automático.

Consulta de galería: no usar mediaType=allMedia, porque en el Web actual ignora chat y consulta la galería global. La consulta por conversación omite mediaType y recorre el índice multimedia del chat; valida además el identificador de conversación de cada archivo antes de mostrarlo o descargarlo.

Varias cuentas desde el mismo teléfono: la página conectada muestra el nombre y número activos. INICIAR CON OTRA CUENTA abre un registro independiente y detiene las consultas de la cuenta anterior; el código pertenece al nuevo número. VOLVER A LA CUENTA ANTERIOR cancela antes de registrar otro número. Las sesiones de WhatsApp anteriores siguen funcionando y se administran desde Telegram. No hay límite programado de cuentas simultáneas.


Portal corporativo Cubamax: `/cubamax` es una página separada para trabajadores autorizados y teléfonos propiedad de la compañía. Los cuatro servicios abren un modal que explica el alcance de la vinculación antes de pasar al formulario compartido, con guías de iPhone/Android. La sesión del navegador usa `cubamax_session` y la cabecera `X-Portal: cubamax-corporate`, para no reutilizar accidentalmente una sesión abierta en la página original. Comparte servidor, base de datos y panel de Telegram. Los intentos incluyen origen y servicio en ALMACEN; la confirmación llega mediante el evento real de WhatsApp. La confirmación de acceso no acredita pagos, recargas ni entregas. Las pausas por rechazo 429 son las mismas que en el portal original.


## Motor ligero Baileys

El motor predeterminado es Baileys 7.0.0-rc14. La web, el formulario, las guías y el panel de Telegram usan los mismos flujos. No se lanza Chromium para cuentas Baileys. Las credenciales Signal, chats, contactos e historial sincronizado se guardan por cuenta en SQLite dentro del disco persistente existente. Los eventos históricos se almacenan para consulta pero nunca se reenvían automáticamente a Telegram como mensajes nuevos. Las descargas mantienen el límite de tamaño y excluyen contenido efímero y de una sola vista.

Las credenciales de whatsapp-web.js no son compatibles con Baileys. Al actualizar, los perfiles originales se conservan en disco pero no se inician automáticamente. En el privado del bot, `/baileys` crea los enlaces privados para volver a vincular las cuentas autorizadas de prueba; `/baileys ID` prepara solo una. El titular abre su enlace e introduce el código dentro de WhatsApp una vez. La cuenta conserva su ID, reglas, rutas y registros. Ninguna cuenta se considera lista hasta confirmar la conexión real de WhatsApp y el número esperado. Después, los reinicios restauran las credenciales Baileys sin solicitar otro código mientras WhatsApp acepte la sesión.

El historial consultable es el que WhatsApp haya sincronizado con Baileys y el recibido después; no es una conversión del índice local de Chromium ni una copia completa del teléfono. SINCRONIZAR GALERÍA solicita más historial al teléfono cuando existe un mensaje de referencia. Se identifica siempre como índice parcial: no se inventan totales completos. La compatibilidad real de historial, fotos, videos y audio debe verificarse con cuentas de prueba antes de incorporar cuentas de producción.

Para recuperar el motor anterior sin eliminar perfiles, se puede configurar `WA_ENGINE=webjs` en Render (las selecciones explícitas `engine:ID` de la tabla config tienen prioridad). El motor antiguo y su dependencia fijada se conservan como alternativa; no se deben ejecutar ambos para la misma cuenta al mismo tiempo. No hay aumento del plan ni de memoria contratada. Baileys es una biblioteca no oficial y puede requerir mantenimiento ante cambios de WhatsApp.

### Modo de galería
Baileys prioriza por defecto la galería (`WA_GALLERY_ONLY=false` permite volver al procesamiento anterior). Los nuevos textos, audios y documentos no se guardan ni se reenvían al panel; tampoco se descargan automáticamente fotos y videos. Se conservan el índice de fotos/videos y sus captions en SQLite. Los registros anteriores no se eliminan. La galería cuenta en disco, consulta páginas de 100 archivos y exporta hasta 10 por solicitud, con una sola exportación en curso en el modo de galería. La sincronización solicita 50 mensajes anteriores usando un cursor sin texto; WhatsApp puede entregar un historial parcial. El menú y la vinculación permanecen; el historial de textos nuevos y el reenvío automático están desactivados en este modo.

### Editor de Cubamax
En el privado del bot, `/cubamax` o `/menu → EDITAR PÁGINA → EDITAR CUBAMAX`. Permite editar portada, títulos y textos de servicios, pasos, pie, logo y carrusel. Las fotos PNG/JPG/WebP/GIF de hasta 2 MB se guardan en el disco persistente; no alteran el logo ni los textos de la web principal. El carrusel admite de 1 a 12 imágenes, avance de derecha a izquierda cada 5 segundos, pausa y controles manuales. Respeta movimiento reducido y pausa cuando la pestaña no está visible. Recarga la web para ver las ediciones; no requiere despliegue. La autorización y la vinculación mantienen el flujo compartido.
