// Runs inside the already authorized WhatsApp Web session; never opens another account.
export async function readAccountPhoto(peer){
  const attempts=[];
  const encode=async url=>{
    const response=await fetch(url,{signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('PHOTO_HTTP_'+response.status);
    const blob=await response.blob();if(!blob.type.startsWith('image/')||!blob.size||blob.size>5*1024*1024)throw Error('PHOTO_INVALID_IMAGE');
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('PHOTO_READ'));reader.onloadend=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);});
    return {data,mime:blob.type};
  };
  try{
    // The bridge needs the native chat model, not the serialized getChatModel result.
    const chat=await window.WWebJS.getChat(peer,{getAsModel:false});
    const pic=await window.require('WAWebContactProfilePicThumbBridge').requestProfilePicFromServer(chat);
    if(pic?.eurl)return {...await encode(pic.eurl),source:'profile',attempts};
    attempts.push('PROFILE_EMPTY');
  }catch(error){attempts.push('PROFILE_'+String(error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'').slice(0,60));}
  try{
    const wid=window.require('WAWebWidFactory').createWid(peer);
    const data=await window.WWebJS.getProfilePicThumbToBase64(wid);
    if(data)return {data,mime:'image/jpeg',source:'thumbnail',attempts};
    attempts.push('THUMB_EMPTY');
  }catch(error){attempts.push('THUMB_'+String(error.name||'Error').replace(/[^a-zA-Z0-9_]/g,'').slice(0,60));}
  return {data:null,attempts};
}
