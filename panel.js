const params = new URLSearchParams(location.search);
const rawUrl = params.get('url');
const address = document.querySelector('#address');
const frame = document.querySelector('#content');
const error = document.querySelector('#error');
const external = document.querySelector('#external');

let target = null;
try{
  const parsed = new URL(rawUrl);
  if(parsed.protocol === 'http:' || parsed.protocol === 'https:') target = parsed.toString();
}catch{}

if(target){
  address.textContent = target;
  address.title = target;
  frame.src = target;
  external.addEventListener('click', ()=> chrome.tabs.create({ url: target }));
}else{
  address.textContent = 'Invalid address';
  frame.hidden = true;
  error.hidden = false;
  external.hidden = true;
}
