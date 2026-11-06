// Textos visibles del flujo PÚBLICO de enlaces WhatsApp. No altera Cubamax
// ni la interfaz de conversación de cuentas WhatsApp conectadas.
const item=(group,label,value,max=1400)=>({group,label,value,max});
export const publicWaCopyCatalog=Object.freeze({
 // Configuración y textos existentes: se conservan las claves publicadas.
 message1:item('public-links','Mensaje WhatsApp 1 · Solicitar código','Escribe el código de tu enlace.'),
 choose:item('public-links','Mensaje inicial · Elegir WhatsApp / Cubamax','Elige qué enlace deseas utilizar.'),
 preview:item('public-links','Vista previa · Foto del popup','🖼 Vista previa del popup que verá el primer visitante.'),
 firstOnly:item('public-links','Aviso · Popup solo para el primer visitante','Este popup solo aparecerá a la primera persona que abra este enlace. Las siguientes personas entrarán directamente en la web. Si quieres el mismo efecto para otro visitante, crea un código diferente.'),
 delivered:item('public-links','Confirmación · Enlace creado','✅ Tu enlace de WhatsApp ya está creado.'),
 accounts:item('public-links','Mensaje de cuentas asociadas','Estas son las cuentas que se vincularon voluntariamente mediante tus enlaces.'),
 ownPhoto:item('public-links','Solicitar foto propia si falla OCR','No pude preparar la foto automáticamente. Envíame tu propia foto para este enlace, con la fecha y la hora correctas. La conservaré exactamente como la envíes y te mostraré una vista previa antes de crear el enlace.'),

 // Instrucciones del chat y vista previa del nuevo envío.
 codeHelp:item('public-links-flow','Ayuda al escribir código','Puedes escribir, por ejemplo: miweb2026.\nUsa /cancelar para salir.'),
 cancelHelp:item('public-links-flow','Ayuda para cancelar','/cancelar para salir.'),
 ownPhotoNotice:item('public-links-flow','Advertencia en vista previa de foto propia','Tu foto se utilizará sin modificar. Comprueba que fecha y hora sean correctas.'),
 countryPrompt:item('public-links-flow','Pregunta del país','🌎 ¿A qué país deseas enviar el enlace por WhatsApp?\n\nEscribe el nombre del país, por ejemplo: Cuba.\n\n/cancelar para salir.'),
 phonePrompt:item('public-links-flow','Pregunta del teléfono · {pais}','📱 País: {pais}\n\nEscribe el número de WhatsApp del destinatario.\nPuede incluir el código internacional o ser un número local de {pais}.\n\n/cancelar para salir.'),
 sendPreviewTitle:item('public-links-flow','Título de vista previa del envío','📤 VISTA PREVIA DEL ENVÍO'),
 sendPreviewDestination:item('public-links-flow','Destino de la vista previa · {numero}, {pais}','Para: {numero} · {pais}'),
 sendPreviewConsent:item('public-links-flow','Aviso de consentimiento antes del envío','Envía este mensaje solamente si el destinatario aceptó recibirlo.'),
 sendSuccess:item('public-links-flow','Confirmación de mensaje enviado · {numero}','✅ Mensaje enviado por WhatsApp a +{numero}.\n\nPuedes administrar este enlace desde MIS ENLACES.'),
 sendSkipped:item('public-links-flow','Envío omitido','Enlace guardado. No se envió ningún mensaje.'),
 cubamaxIntro:item('public-links-flow','Texto al elegir Cubamax','CUBAMAX\n\nhttps://cubamaxcom.online\n\nEl sistema de Cubamax conserva su funcionamiento actual.'),

 // Listados, detalles y administración de enlaces.
 myLinksTitle:item('public-links-manage','Cabecera · Mis enlaces','🔗𝐌𝐈𝐒 𝐄𝐍𝐋𝐀𝐂𝐄𝐒 𝐀𝐂𝐓𝐈𝐕𝐎𝐒'),
 myLinksHelp:item('public-links-manage','Ayuda · Lista con enlaces','Selecciona el número del enlace que deseas administrar:'),
 myLinksCount:item('public-links-manage','Resumen · Cantidad de enlaces · {total}','{total} enlaces creados'),
 myLinksItem:item('public-links-manage','Formato de cada enlace · {indice}, {codigo}, {estado}, {enlace}, {cuentas}, {tipo}','{indice}. {codigo} · {estado}\n🔗 {enlace}\n📱 {cuentas} {tipo}'),
 myLinksOneAccount:item('public-links-manage','Etiqueta · Una cuenta vinculada','cuenta vinculada',80),
 myLinksManyAccounts:item('public-links-manage','Etiqueta · Varias cuentas vinculadas','cuentas vinculadas',80),
 myLinksEmpty:item('public-links-manage','Lista de enlaces vacía','Todavía no has creado enlaces.'),
 linkDetail:item('public-links-manage','Detalles del enlace · {codigo}, {estado}, {cuentas}, {enlace}','ENLACE WHATSAPP\nCódigo: {codigo}\nEstado: {estado}\nCuentas vinculadas voluntariamente: {cuentas}\n\n{enlace}\n\nRevocar o eliminar el enlace NO desconecta cuentas de WhatsApp.'),
 linkedAccountsTitle:item('public-links-manage','Cabecera · Cuentas asociadas · {codigo}','CUENTAS ASOCIADAS · {codigo}'),
 linkedAccountsLine:item('public-links-manage','Fila de cuenta · {indice}, {numero}, {estado}, {detalle}','{indice}. +{numero} · {detalle} · {estado}'),
 linkedAccountsEmpty:item('public-links-manage','Sin cuentas asociadas','Todavía no hay cuentas asociadas.'),
 linkedAccountsNote:item('public-links-manage','Nota al consultar cuentas','La asociación es informativa; no concede acceso a las conversaciones.'),
 linkedPreviously:item('public-links-manage','Cuenta vinculada anteriormente','Conectada anteriormente'),
 linkedInProgress:item('public-links-manage','Cuenta en proceso','En proceso'),
 activeStatus:item('public-links-manage','Estado · Activo','ACTIVO',64),
 revokedStatus:item('public-links-manage','Estado · Revocado','REVOCADO',64),
 revokedLink:item('public-links-manage','Dirección de enlace revocado','Enlace revocado.'),
 revokePrompt:item('public-links-manage','Aviso para revocar · {codigo}','¿Revocar {codigo}? El enlace dejará de abrir la web. Las cuentas ya conectadas NO serán desconectadas.'),
 deletePrompt:item('public-links-manage','Aviso para eliminar · {codigo}','¿Eliminar definitivamente el enlace {codigo} y su historial de asociaciones? No se eliminarán cuentas conectadas.'),

 // Avisos y errores propios del nuevo flujo. {error} incluye el detalle.
 cancelled:item('public-links-alerts','Confirmación al cancelar','Cancelado.'),
 inactiveLink:item('public-links-alerts','El enlace no está activo','Este enlace no está activo.'),
 codeMissing:item('public-links-alerts','Se esperaba un código','Escribe tu código en un mensaje de texto.'),
 codeInvalid:item('public-links-alerts','Código inválido · {error}','{error}'),
 codeTaken:item('public-links-alerts','Código ya utilizado','Ese código ya se está utilizando. Elige otro.'),
 photoMissing:item('public-links-alerts','Foto predeterminada no disponible','No hay foto predeterminada disponible.'),
 ocrUnavailable:item('public-links-alerts','Fallo de OCR','No pude actualizar automáticamente la fecha y la hora de la foto predeterminada.'),
 photoExpected:item('public-links-alerts','Se esperaba una fotografía','Envía una fotografía como imagen o archivo.'),
 photoError:item('public-links-alerts','Error al subir foto · {error}','{error}\n\nInténtalo de nuevo con otra foto.'),
 createFailed:item('public-links-alerts','Error al crear enlace · {error}','No fue posible generar el enlace. {error}\n\nNo se modificó ninguna cuenta conectada.'),
 countryInvalid:item('public-links-alerts','Error de país · {error}','{error}'),
 phoneInvalid:item('public-links-alerts','Error de teléfono · {error}','{error}'),
 senderUnavailable:item('public-links-alerts','Número de envío no disponible · {error}','⚠️ {error}\n\nTu enlace ya está creado. Puedes usar el botón ENVIAR POR WHATSAPP cuando la cuenta de envío esté conectada.'),
 messageInvalid:item('public-links-alerts','Error en el mensaje a enviar · {error}','⚠️ {error}'),
 confirmExpired:item('public-links-alerts','Confirmación de envío vencida','La confirmación venció. Abre MIS ENLACES y elige ENVIAR POR WHATSAPP.'),
 sendFailed:item('public-links-alerts','Error al enviar · {error}','⚠️ {error}\n\nTu enlace sigue activo.'),
 noOwnership:item('public-links-alerts','Enlace ajeno o eliminado','Este enlace no te pertenece o fue eliminado.'),
 noLink:item('public-links-alerts','Enlace no disponible','Enlace no disponible.'),
 unknownOption:item('public-links-alerts','Opción no reconocida','Opción no disponible.'),
 invalidLinkAction:item('public-links-alerts','Acción sobre enlace no disponible','Ese enlace no está disponible para tu cuenta.'),

 // Cada botón se puede renombrar por separado; callback_data NO se edita.
 buttonWhatsApp:item('public-buttons','Botón · Elegir WhatsApp','📲𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩',64),
 buttonCubamax:item('public-buttons','Botón · Elegir Cubamax','🇨🇺𝐂𝐮𝐛𝐚𝐦𝐚𝐱',64),
 buttonMyLinks:item('public-buttons','Botón · Mis enlaces (inicio)','🔗𝐌𝐢𝐬 𝐞𝐧𝐥𝐚𝐜𝐞𝐬 𝐚𝐜𝐭𝐢𝐯𝐨𝐬',64),
 buttonOwnPanel:item('public-buttons','Botón · Panel web (solo si tiene cuentas vinculadas)','🖥 ABRIR PANEL WEB',64),
 buttonViewLinks:item('public-buttons','Botón · Ver mis enlaces (tras crear)','📋 VER MIS ENLACES',64),
 buttonSendLink:item('public-buttons','Botón · Enviar por WhatsApp','📤 ENVIAR POR WHATSAPP',64),
 buttonAssociatedAccounts:item('public-buttons','Botón · Cuentas asociadas','🔎 CUENTAS ASOCIADAS',64),
 buttonRevoke:item('public-buttons','Botón · Revocar enlace','🚫 REVOCAR ENLACE',64),
 buttonDelete:item('public-buttons','Botón · Eliminar enlace','🗑 ELIMINAR ENLACE',64),
 buttonCreateAnother:item('public-buttons','Botón · Crear otro enlace','➕ CREAR OTRO ENLACE',64),
 buttonSites:item('public-buttons','Botón · WhatsApp/Cubamax','🔀 WHATSAPP / CUBAMAX',64),
 buttonSkip:item('public-buttons','Botón · Omitir envío','⏭ OMITIR ENVÍO',64),
 buttonConfirmSend:item('public-buttons','Botón · Confirmar envío','✅ ENVIAR MENSAJE',64),
 buttonCancel:item('public-buttons','Botón · Cancelar envío','❌ CANCELAR',64),
 buttonPrevious:item('public-buttons','Botón · Anterior','◀ ANTERIOR',64),
 buttonNext:item('public-buttons','Botón · Siguiente','SIGUIENTE ▶',64),
 buttonCreate:item('public-buttons','Botón · Crear enlace desde lista','➕ CREAR ENLACE',64),
 buttonBack:item('public-buttons','Botón · Atrás','ATRÁS',64),
 buttonReturn:item('public-buttons','Botón · Volver (Cubamax)','VOLVER',64),
 buttonConfirmRevoke:item('public-buttons','Botón · Confirmar revocación','SÍ, REVOCAR',64),
 buttonConfirmDelete:item('public-buttons','Botón · Confirmar eliminación','SÍ, ELIMINAR',64),
 buttonCancelAction:item('public-buttons','Botón · Cancelar revocación/eliminación','CANCELAR',64),
});
export const publicWaCopyDefaults=Object.freeze(Object.fromEntries(
 Object.entries(publicWaCopyCatalog).map(([key,item])=>[key,item.value])
));
// Sustituir marcadores no cambia números, URLs, permisos ni destinos.
export function renderPublicWaCopy(template,data={}){
 return String(template).replace(/\{([a-z][a-z0-9_]*)\}/gi,(whole,key)=>{
  if(!Object.prototype.hasOwnProperty.call(data,key))return whole;
  return String(data[key]??'');
 });
}
