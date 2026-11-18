function database():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const req=indexedDB.open('zhixu-images-v1',1);req.onupgradeneeded=()=>req.result.createObjectStore('images');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(Error('无法打开原图存储：'+req.error?.message));});}
export async function saveOriginal(id:string,file:Blob){const db=await database();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(file,id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(Error('原图保存失败：'+tx.error?.message));tx.onabort=()=>reject(Error('原图保存被中断'));});}finally{db.close();}}
export async function loadOriginal(id:string):Promise<Blob>{const db=await database();try{return await new Promise((resolve,reject)=>{const req=db.transaction('images').objectStore('images').get(id);req.onsuccess=()=>req.result instanceof Blob?resolve(req.result):reject(Error('未找到原图'));req.onerror=()=>reject(Error('原图读取失败'));});}finally{db.close();}}

export async function compress(file:Blob):Promise<string>{
 const bitmap=await createImageBitmap(file);try{if(bitmap.width*bitmap.height>60000000)throw Error('图片像素过大，请裁剪后重传');const scale=Math.min(1,1800/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext('2d');if(!ctx)throw Error('浏览器无法压缩图片');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);const result=canvas.toDataURL('image/jpeg',0.82);if(result.length>3*1024*1024)throw Error('压缩后仍过大，请裁剪重传');return result;}finally{bitmap.close();}
}

export async function readBackupImages(): Promise<[string, Blob][]> {
 const db = await database();
 try {
  return await new Promise((resolve, reject) => {
   const transaction = db.transaction('images', 'readonly');
   const cursor = transaction.objectStore('images').openCursor();
   const entries: [string, Blob][] = [];
   cursor.onsuccess = () => {
    const row = cursor.result;
    if (!row) return;
    if (typeof row.key !== 'string' || !(row.value instanceof Blob)) {
     transaction.abort();
     return;
    }
    entries.push([row.key, row.value]);
    row.continue();
   };
   transaction.oncomplete = () => resolve(entries);
   transaction.onabort = () => reject(Error('无法读取原图备份'));
  });
 } finally { db.close(); }
}

export async function replaceBackupImages(entries: [string, Blob][]): Promise<void> {
 const db = await database();
 try {
  await new Promise<void>((resolve, reject) => {
   const transaction = db.transaction('images', 'readwrite');
   const store = transaction.objectStore('images');
   transaction.oncomplete = () => resolve();
   transaction.onabort = () => reject(Error('原图恢复失败，可能是浏览器存储空间不足。'));
   store.clear();
   for (const [id, image] of entries) store.put(image, id);
  });
 } finally { db.close(); }
}
