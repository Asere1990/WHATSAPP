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
| `ADMIN_CHAT_ID` | Panel interno de conversaciones: `-1004466212290`, el mismo grupo de ALMACEN |
| `PUBLIC_URL` | Opcional: URL pública HTTPS; se usa `RENDER_EXTERNAL_URL` si se omite |
| `DATA_DIR` | `/var/data`, siempre dentro del disco persistente |
| `MAX_ACCOUNTS` | Límite inicial conservador: 2; no es una capacidad garantizada |
| `MAX_MEDIA_MB` | Máximo por archivo descargado: 20 MB por defecto |

La página inicia sin secretos para permitir verificar el diseño, pero rechaza vincular cuentas mientras falten el bot, el panel o administradores. Los operadores se declaran en `admins.txt`, un ID numérico por línea; incluye al propietario `7539025033`. El Dockerfile incorpora el archivo al servicio. Nunca guardar tokens ni sesiones en GitHub.

## Operación

1. El titular abre la URL pública y pulsa **CONECTAR CUENTA**. Introduce su número y acepta la autorización. El sistema crea un acceso de navegador sin enlace de invitación. La confirmación de la cuenta se hace dentro de WhatsApp. El operador también puede usar `/invitar +NUMERO Nombre` para altas asistidas.
2. Solo en el alta asistida se genera un enlace privado con fragmento, de un solo uso y válido 24 h. Enviarlo únicamente al titular de la cuenta. Al abrirlo se intercambia por una cookie HttpOnly; el fragmento se elimina del navegador.
3. El titular confirma su número y autoriza explícitamente la lectura, respuestas y manejo de archivos. El servidor muestra un código de vinculación que se introduce **dentro de WhatsApp**. Nunca solicitar códigos de registro SMS ni PIN. El código no se envía al panel.
4. El servidor verifica que la cuenta vinculada corresponde al número invitado. Recibe mensajes privados nuevos y los lleva al panel autorizado. No importa historiales anteriores ni mensajes de grupos, estados o enviados por el propio titular.
5. Un operador responde al mensaje del panel con texto, foto, video o documento; se envía desde la cuenta WhatsApp correspondiente. Los registros de rutas persisten entre reinicios. Las respuestas que WhatsApp acepta se consideran enviadas, no necesariamente entregadas al destinatario.
6. `/regla ID frase | respuesta` configura respuestas de coincidencia exacta y sin IA; `/reglas ID`, `/borrarregla NUMERO` las administran.
7. `/pausar ID`, `/activar ID`, `/reconectar ID`, `/desconectar ID` controlan la cuenta. Desconectar requiere confirmar. El titular también puede pausar y revocar desde su página o desde Dispositivos vinculados de WhatsApp.
8. `🎨 EDITAR PÁGINA` permite cambiar logo, título, descripción, botón y color. La autorización no es editable. Vista previa: la URL pública; los textos se insertan como texto, nunca como HTML.

El bot solo admite administradores declarados, en su DM o el panel configurado. En un grupo panel, todos sus miembros pueden ver el contenido; el dueño debe controlar su membresía. No compartir el panel con clientes distintos.

## Archivos, límites y recuperación

Fotos, videos y documentos recibidos se descargan si WhatsApp proporciona un tamaño válido bajo el límite configurado. Los medios efímeros y de visualización única no se archivan. Archivos demasiado grandes, sin tamaño o no disponibles se notifican y no se descargan. Los archivos se guardan en el disco y se envían como documentos a Telegram; Telegram puede impedir determinadas transferencias. No se descargan archivos mayores a 20 MB desde el bot de Telegram para responder.

Los archivos locales y el texto de la bandeja se eliminan después de 7 días, con mantenimiento cada hora. Las copias enviadas a Telegram tienen retención independiente y no se borran automáticamente. Auditoría sin contenido: 90 días; rutas: últimas 10.000. Sesiones y datos de cuentas persisten mientras se mantenga el servicio. La pausa no recupera automáticamente los mensajes recibidos durante la pausa.

Cada cuenta procesa mensajes en orden, con límite de cola 200. Si se llena, se pausa y se avisa. La bandeja registra mensajes procesados por ID para no ejecutar dos veces la misma entrada. Un fallo incierto se marca para revisión con `/pendientes`; no se reenvía automáticamente un mensaje que podría haberse enviado. Tras un reinicio, los registros `processing` también requieren revisión manual. No existe garantía de entrega exactamente una vez, de recuperación de todos los mensajes perdidos durante desconexiones ni de capacidad para alto volumen sin prueba real.

## Validación

Node 24. `npm install`, `npm run check`, `npm test`. Docker incluye Chromium; para ejecución local se debe disponer de Chrome/Chromium. `npm start` escucha en `0.0.0.0:$PORT`; `/health` verifica el servicio HTTP. Una comprobación HTTP correcta no verifica WhatsApp ni Telegram: hace falta prueba de aceptación con una cuenta del titular y el bot configurado.

La prueba de aceptación debe cubrir vinculación en iPhone/Android, envío y recepción de texto/foto/video/documento, respuesta desde Telegram, aislamiento entre dos cuentas, pausa, revocación, reinicio con disco, desconexión y carga sostenida antes de admitir clientes del contrato.
