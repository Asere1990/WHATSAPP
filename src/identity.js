import { parsePhoneNumberFromString } from 'libphonenumber-js';
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
