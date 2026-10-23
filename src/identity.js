import { parsePhoneNumberFromString, getCountries } from 'libphonenumber-js';
export const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function clippedHTML(value,budget=2000){let out='';for(const c of String(value??'')){const escaped=escapeHTML(c);if(out.length+escaped.length>budget)return out+'…';out+=escaped;}return out;}
export function countryOf(phone) {
  const parsed=parsePhoneNumberFromString(`+${phone}`);
  return parsed?.country?new Intl.DisplayNames(['es'],{type:'region'}).of(parsed.country):'País no determinado';
}
export function personLink(person) {
  const label=escapeHTML(person.name||'Sin nombre');
  return person.phone&&/^[1-9][0-9]{7,14}$/.test(person.phone)?`<a href="https://wa.me/${person.phone}">${label}</a> (+${person.phone})`:label+' · número no disponible';
}

export function webPhone(input){
  if(input.country===undefined)return String(input.phone||'').replace(/[ +()-]/g,'');
  if(!getCountries().includes(input.country)||typeof input.nationalNumber!=='string'||!/^[0-9]{4,15}$/.test(input.nationalNumber))throw Error('Usa un país de la lista y escribe tu número sin código internacional.');
  const parsed=parsePhoneNumberFromString(input.nationalNumber,input.country);
  if(!parsed?.isPossible())throw Error('Usa un número válido para el país seleccionado.');
  return parsed.number.slice(1);
}
export function phoneParts(phone){const p=parsePhoneNumberFromString('+'+String(phone).replace(/^\+/,''));return {country:p?.country||null,nationalNumber:p?.nationalNumber||''};}
