// Counts reflect WhatsApp messages already indexed for this account/chat.
// They are not a claim about everything still held by the WhatsApp phone.
const photoPaths="json_type(value,'$.message.imageMessage') IS NOT NULL";
const videoPaths="json_type(value,'$.message.videoMessage') IS NOT NULL";
const logicalKey="json_extract(value,'$.key.id') || '|' || COALESCE(json_extract(value,'$.key.fromMe'),0) || '|' || COALESCE(json_extract(value,'$.key.participant'),'')";

export function galleryMetrics(store,account,db,peer,archive,filter,peers){
  const photos='('+photoPaths+(filter.self?" OR json_type(value,'$.message.deviceSentMessage.message.imageMessage') IS NOT NULL":'')+')';
  const videos='('+videoPaths+(filter.self?" OR json_type(value,'$.message.deviceSentMessage.message.videoMessage') IS NOT NULL":'')+')';
  const expression=`COUNT(DISTINCT CASE WHEN ${photos} THEN ${logicalKey} END) AS photos, COUNT(DISTINCT CASE WHEN ${videos} THEN ${logicalKey} END) AS videos`;
  const aliases=peers.map(()=>'?').join(',');
  const criteria=`account=? AND kind='message' AND peer IN (${aliases})${filter.sql}`;
  const counts=store.db.prepare(`SELECT ${expression} FROM baileys_data WHERE ${criteria}`)
    .get(account,...peers,...filter.params);
  const detected={photos:Number(counts?.photos||0),videos:Number(counts?.videos||0)};
  // Only a completed, persisted offline-media archive record counts as saved.
  // No download, synchronization request or source-message mutation occurs here.
  let downloaded=null;
  if(archive?.allowed(account)){
    const ready=store.db.prepare(`SELECT ${expression} FROM baileys_data
      JOIN offline_media AS offline ON offline.account=baileys_data.account
        AND offline.message=baileys_data.id AND offline.status='ready'
      WHERE ${criteria}`).get(account,...peers,...filter.params);
    downloaded={photos:Number(ready?.photos||0),videos:Number(ready?.videos||0)};
  }
  const snapshots=peers.map(p=>db.get('media-first-batch',p)).filter(row=>
    row&&Number.isFinite(row.recordedAt)&&row.recordedAt>0);
  let firstBatch=null;
  if(snapshots.length){
    const firstAt=Math.min(...snapshots.map(row=>row.recordedAt));
    const first=snapshots.filter(row=>row.recordedAt===firstAt);
    firstBatch={
      photos:first.reduce((n,row)=>n+Number(row.photos||0),0),
      videos:first.reduce((n,row)=>n+Number(row.videos||0),0),
      recordedAt:firstAt
    };
  }
  return {detected,downloaded,firstBatch};
}
