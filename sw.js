const CACHE_NAME='papertrail-v26';
const APP_SHELL=['./main.css','./account-menu.css','./app.js','./account-actions.js','./auth.html','./auth.css','./auth.js','./offline.html','./manifest.webmanifest','./icons/apple-touch-icon.png','./icons/icon-192.png','./icons/icon-512.png','./icons/the-walkin-logo.png'];
const APP_URLS=new Set(APP_SHELL.map(asset=>new URL(asset,self.registration.scope).pathname));

self.addEventListener('install',event=>event.waitUntil(
	caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_SHELL.map(asset=>new Request(asset,{cache:'reload'})))).then(()=>self.skipWaiting())
));

self.addEventListener('activate',event=>event.waitUntil(
	caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('papertrail-')&&key!==CACHE_NAME).map(key=>caches.delete(key))))
		.then(()=>self.clients.claim())
));

self.addEventListener('fetch',event=>{
	const request=event.request;
	const url=new URL(request.url);
	if(request.method!=='GET'||url.origin!==self.location.origin)return;

	if(request.mode==='navigate'){
		event.respondWith(fetch(request).catch(async()=>{
			const offlinePage=await caches.match(new URL('./offline.html',self.registration.scope).href);
			if(!offlinePage)throw new Error('The authentication service is offline and no offline page is available.');
			return offlinePage;
		}));
		return;
	}

	if(!APP_URLS.has(url.pathname))return;
	event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
		if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
		return response;
	})));
});