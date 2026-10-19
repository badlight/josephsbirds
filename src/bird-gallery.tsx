import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, type FormEvent, type PointerEvent } from "react";
import { Feather, Search, Plus, Camera, MapPin, CalendarDays, X, Upload, ImagePlus, Clock3 } from "lucide-react";
import { photoUrl, type Bird, type BirdPhoto, type Catalogue, type GPSLocation } from "./models";
import { loadCatalogue, stagePhotos, stageCover, stagePhotoDetails, publishDraft, discardDraft, manageMode } from "./store";

import { activeCollection,validGPS } from "./collection";
import { browseBirds } from "./browse";
import { familyLabels } from "./geo";
import { AlbumManager,PhotoOrganizer } from "./album-manager";
import PhotoDetailsDialog from "./photo-details-dialog";
const PhotoMap=lazy(()=>import("./photo-map"));
const UploadDialog=lazy(()=>import("./upload-dialog"));

function setAlbumURL(birdId = "", photoId = "", push = false) {
  const url = new URL(window.location.href);
  for (const [key,value] of [["bird",birdId],["photo",photoId]]) { if (value) url.searchParams.set(key,value); else url.searchParams.delete(key); }
  window.history[push ? "pushState" : "replaceState"]({},"",url);
}

type BrowsePreferences={query?:string;family?:string;sort?:string;kind?:string;year?:string;locationFilter?:string;status?:string;view?:string;lastBirdId?:string;lastPhotoId?:string};
const preferenceKey="josephsbirds-browse-v2-"+(manageMode?"manager":"public");
function readPreferences():BrowsePreferences{try{const raw=JSON.parse(localStorage.getItem(preferenceKey)||"{}");if(!raw||typeof raw!=="object")return {};return Object.fromEntries(Object.entries(raw).filter(([,v])=>typeof v==="string"&&v.length<400));}catch{return {};}}
function writePreferences(value:BrowsePreferences){try{localStorage.setItem(preferenceKey,JSON.stringify(value));}catch{}}

const coverPhoto = (bird: Bird) => bird.photos.find(photo => photo.id === bird.coverPhotoId) || bird.photos[0];

function DraftPanel({count,onReload}:{count:number;onReload:()=>Promise<Catalogue>}) {
  const [publishing,setPublishing]=useState(false),[confirmDiscard,setConfirmDiscard]=useState(false),[notice,setNotice]=useState("");
  return <section className="draft-panel" aria-label="Photo manager">
    <div><span className="eyebrow">Photo manager</span><h2>{count ? `${count} album${count===1?"":"s"} in your draft` : "Ready for your next photograph"}</h2><p>Save photographs to a draft, choose your covers, then publish. Drafts stay in this browser until you publish them.</p></div>
    <div className="draft-actions"><button className="primary" disabled={!count} onClick={()=>setPublishing(true)}>Publish draft</button>{count>0 && <button onClick={()=>setConfirmDiscard(true)}>Discard draft</button>}</div>
    {notice && <p className="draft-notice" role="status">{notice}</p>}
    {publishing && <PublishDialog count={count} onClose={()=>setPublishing(false)} onComplete={async()=>{await onReload();setPublishing(false);setNotice("Published to GitHub. Your public gallery will update when GitHub Pages finishes deploying.");}}/>}
    {confirmDiscard && <DiscardDialog onClose={()=>setConfirmDiscard(false)} onDiscard={async()=>{await discardDraft();await onReload();setConfirmDiscard(false);}}/>}
  </section>;
}

function PublishDialog({count,onClose,onComplete}:{count:number;onClose:()=>void;onComplete:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null),token=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[error,setError]=useState("");
  useEffect(()=>{if(!dialog.current?.open)dialog.current?.showModal();return()=>{if(token.current)token.current.value="";};},[]);
  const close=()=>{if(token.current)token.current.value="";onClose();};
  const submit=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setError("");
    try{await publishDraft(token.current?.value||"",setProgress);await onComplete();}
    catch(err){setError(err instanceof Error?err.message:"Publishing failed. Your draft has been kept.");}
    finally{if(token.current)token.current.value="";setBusy(false);setProgress("");}
  };
  return <dialog ref={dialog} className="upload-dialog publish-dialog" aria-labelledby="publish-title" onCancel={event=>{event.preventDefault();if(!busy)close();}}>
    <div className="upload-heading"><div><span className="eyebrow">Your public gallery</span><h2 id="publish-title">Publish your draft</h2></div><button className="icon-button" aria-label="Close publisher" disabled={busy} onClick={close}><X size={22}/></button></div>
    <p>Publish {count} album{count===1?"":"s"} to <strong>badlight/josephsbirds</strong>. These photographs and their details will be public.</p>
    <form onSubmit={submit}><fieldset disabled={busy}><label htmlFor="github-token">GitHub token<input id="github-token" ref={token} type="password" required autoComplete="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true"/></label>
      <p className="token-help">Use a fine-grained GitHub token limited to <strong>josephsbirds</strong> with <strong>Contents: Read and write</strong>. The token is used for this publish only and is cleared afterward. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a token on GitHub</a></p>
    </fieldset><p className="form-error" role="alert">{error}</p><div className="form-actions"><span role="status">{progress}</span><button type="button" disabled={busy} onClick={close}>Cancel</button><button type="submit" className="primary" disabled={busy}>{busy?"Publishing…":"Publish photographs"}</button></div></form>
  </dialog>;
}

function DiscardDialog({onClose,onDiscard}:{onClose:()=>void;onDiscard:()=>Promise<void>}) {
  const dialog=useRef<HTMLDialogElement>(null);const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{if(!dialog.current?.open)dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="upload-dialog" aria-labelledby="discard-title" onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <h2 id="discard-title">Discard this draft?</h2><p>This removes unpublished photographs and detail changes from this browser. Published photographs stay in the gallery.</p><p className="form-error" role="alert">{error}</p><div className="form-actions"><button disabled={busy} onClick={onClose}>Keep draft</button><button disabled={busy} onClick={async()=>{setBusy(true);try{await onDiscard();}catch(err){setError(err instanceof Error?err.message:"The draft could not be discarded.");setBusy(false);}}}>{busy?"Discarding…":"Discard draft"}</button></div>
  </dialog>;
}

export default function BirdGallery() {
  const preferences=useRef(readPreferences());
  const [lastPhoto,setLastPhoto]=useState({birdId:preferences.current.lastBirdId||"",photoId:preferences.current.lastPhotoId||""});
  const [catalogue,setCatalogue] = useState<Catalogue>({version:1,birds:[],canManage:manageMode,draftCount:0});
  const [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [query,setQuery] = useState(preferences.current.query||""), [family,setFamily] = useState(preferences.current.family||""), [sort,setSort] = useState(preferences.current.sort||"name");
  const [kind,setKind] = useState(preferences.current.kind||"");
  const [year,setYear]=useState(preferences.current.year||""),[locationFilter,setLocationFilter]=useState(preferences.current.locationFilter||""),[status,setStatus]=useState(preferences.current.status||""),[view,setView]=useState(preferences.current.view||"albums"),[importNotice,setImportNotice]=useState("");
  const clearFilters=()=>{setQuery("");setFamily("");setKind("");setYear("");setLocationFilter("");setStatus("");};
  const [selection,setSelection] = useState({birdId:"",photoId:""});
  const [adding,setAdding] = useState<string|null>(null);
  useEffect(()=>{preferences.current={...preferences.current,query,family,sort,kind,year,locationFilter,status,view};writePreferences(preferences.current);},[query,family,sort,kind,year,locationFilter,status,view]);
  useEffect(()=>{if(!selection.birdId||!selection.photoId)return;preferences.current={...preferences.current,lastBirdId:selection.birdId,lastPhotoId:selection.photoId};setLastPhoto(selection);writePreferences(preferences.current);},[selection.birdId,selection.photoId]);
  const reload = useCallback(async () => {
    const data = await loadCatalogue();
    setCatalogue(data); setError(""); return data;
  },[]);
  useEffect(() => {
    const read = () => { const params = new URL(window.location.href).searchParams; setSelection({birdId:params.get("bird")||"",photoId:params.get("photo")||""}); };
    read(); window.addEventListener("popstate",read);
    reload().catch(err => setError(err.message)).finally(() => setLoading(false));
    return () => window.removeEventListener("popstate",read);
  },[reload]);
  const open = (bird: Bird, id = coverPhoto(bird)?.id || "", push = true) => {
    setSelection({birdId:bird.id,photoId:id}); setAlbumURL(bird.id,id,push);
  };
  const close = () => { setSelection({birdId:"",photoId:""}); setAlbumURL(); };
  const active=useMemo(()=>activeCollection(catalogue),[catalogue]);
  const totalPhotos=active.birds.reduce((sum,bird)=>sum+bird.photos.length,0);
  const birdAlbums=active.birds.filter(bird=>bird.kind!=="wildlife").length,wildlifeAlbums=active.birds.length-birdAlbums;
  const families=[...new Set(active.birds.filter(bird=>!kind||(bird.kind||"bird")===kind).map(b=>b.family).filter(Boolean))].sort((a,b)=>(familyLabels[a]||a).localeCompare(familyLabels[b]||b));
  const years=[...new Set(active.birds.flatMap(b=>b.photos.map(p=>p.capturedOn.slice(0,4)).filter(Boolean)))].sort().reverse();
  const visible=useMemo(()=>browseBirds(catalogue,{query,family,kind,year,location:locationFilter,status,sort}),[catalogue,query,family,kind,year,locationFilter,status,sort]);
  const rawBird=catalogue.birds.find(b=>b.id===selection.birdId);
  const showingTrash=catalogue.canManage&&!!(rawBird?.archivedAt||rawBird?.photos.find(p=>p.id===selection.photoId)?.trashedAt);
  const selectedBird=rawBird&&(!rawBird.archivedAt||catalogue.canManage)?{...rawBird,photos:rawBird.photos.filter(p=>showingTrash?(rawBird.archivedAt||p.trashedAt):!p.trashedAt)}:undefined;
  const pendingPhotos=new Set(catalogue.pendingPhotoIds||[]),pendingAlbums=new Set(catalogue.pendingAlbumIds||[]);
  const openMapPhoto=(birdId:string,photoId:string)=>{const b=catalogue.birds.find(b=>b.id===birdId);if(b)open(b,photoId);};

  return <>
    <a className="skip-link" href="#collection">Skip to photographs</a>
    <header className="site-header"><div className="header-inner">
      <div className="brand"><span className="eyebrow"><Feather size={17} aria-hidden="true"/> Bird &amp; wildlife photography</span><h1><a href="./">Joseph&apos;s Birds</a></h1></div>
      <div className="header-actions"><p>{loading ? "Loading collection…" : `${active.birds.length} albums · ${totalPhotos} ${totalPhotos === 1 ? "photograph" : "photographs"}`}</p>
        {catalogue.canManage && <button className="primary" onClick={() => setAdding("new")}><Plus size={18} aria-hidden="true"/> Add a bird</button>}
      </div>
    </div></header>
    <main id="collection">
      {catalogue.canManage && <DraftPanel count={catalogue.draftCount} onReload={reload}/>}{catalogue.canManage&&catalogue.birds.some(b=>b.id===lastPhoto.birdId&&!b.archivedAt&&b.photos.some(p=>p.id===lastPhoto.photoId&&!p.trashedAt))&&<button className="resume-photo" onClick={()=>{const b=catalogue.birds.find(b=>b.id===lastPhoto.birdId);if(b)open(b,lastPhoto.photoId);}}>Resume last photograph</button>}
      {catalogue.birds.length > 0 && <section className="collection-controls" aria-label="Browse wildlife photographs">
        <label className="search-field"><span className="sr-only">Search photographs</span><Search size={19} aria-hidden="true"/><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search species, filename, location, caption…"/></label>
        {families.length > 0 && <label className="select-field"><span className="sr-only">Bird family</span><select value={family} onChange={event => setFamily(event.target.value)}><option value="">All families</option>{families.map(item => <option key={item} value={item}>{familyLabels[item]||item}</option>)}</select></label>}
        <label className="select-field"><span className="sr-only">Sort albums</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="name">Name, A–Z</option><option value="recent">Recently added</option><option value="photographed">Recently photographed</option></select></label>
      </section>}
      {catalogue.birds.length>0&&<div className="collection-extra-controls"><label>Year<select value={year} onChange={e=>setYear(e.target.value)}><option value="">All years</option>{years.map(y=><option key={y}>{y}</option>)}</select></label><label>Location<input type="search" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)} placeholder="Any location"/></label>{catalogue.canManage&&<label>Review<select value={status} onChange={e=>setStatus(e.target.value)}><option value="">All active photographs</option><option value="pending">Pending edits</option><option value="missing-location">Missing location label</option><option value="missing-gps">Missing GPS</option><option value="review">Needs identification review</option><option value="trash">Trash</option></select></label>}<div className="view-switch" role="group" aria-label="Collection view"><button aria-pressed={view==="albums"} onClick={()=>setView("albums")}>Albums</button><button aria-pressed={view==="map"} onClick={()=>setView("map")}>Map</button></div></div>}
      {importNotice&&<div className="import-notice" role="status">{importNotice}<button className="text-button" onClick={()=>setImportNotice("")}>Dismiss</button></div>}
      {error && <div className="message error" role="alert"><p>{error}</p><button onClick={() => reload().catch(err => setError(err.message))}>Try again</button></div>}
      {loading && <div className="collection-loading" role="status"><Feather size={30} aria-hidden="true"/><p>Loading photographs…</p></div>}
      {!loading && !error && !catalogue.birds.length && <section className="first-bird">
        <div className="empty-illustration" aria-hidden="true"><div className="empty-frame"><Feather size={100} strokeWidth={.8}/><span className="frame-dot"/></div><span className="empty-label">A new field of view</span></div>
        <div className="empty-copy"><span className="eyebrow">Your bird collection</span><h2>A collection waiting<br/>to take flight.</h2><p>{catalogue.canManage ? "Add a bird and its photographs to start your gallery. Each species has an album of its own." : "Bird photographs by Joseph Botros. New species and moments from the field will appear here soon."}</p>
          {catalogue.canManage && <button className="primary" onClick={() => setAdding("new")}><ImagePlus size={19} aria-hidden="true"/> Add your first bird</button>}
        </div>
      </section>}
      {!loading && catalogue.birds.length > 0 && <>
        {wildlifeAlbums>0 && <div className="collection-kinds" role="group" aria-label="Type of wildlife">{[["","All wildlife",active.birds.length],["bird","Birds",birdAlbums],["wildlife","Other wildlife",wildlifeAlbums]].map(([value,label,count])=><button key={value} aria-pressed={kind===value} className={kind===value?"active":""} onClick={()=>{setKind(String(value));setFamily("");}}>{label} <span>{count}</span></button>)}</div>}
        <div className="results-line"><span>{visible.length} album{visible.length===1?"":"s"} · {visible.reduce((sum,bird)=>sum+bird.photos.length,0)} photographs</span>{(query || family || kind || year || locationFilter || status) && <button className="text-button" onClick={clearFilters}>Clear filters</button>}</div>
        {view==="map"?<Suspense fallback={<div className="collection-loading">Loading location map…</div>}><PhotoMap birds={visible} onOpen={openMapPhoto}/></Suspense>:<section className="bird-grid" aria-label="Photographed wildlife">{visible.map(bird => {
          const cover = coverPhoto(bird);
          return <article className="bird-card" key={bird.id}><button className="bird-open" onClick={() => open(bird)} aria-label={`View ${bird.name} photographs`}>
            <div className="bird-picture">{cover ? <img src={photoUrl(cover,true)} alt={bird.name} loading="lazy" decoding="async"/> : <Feather className="missing-photo" size={50} aria-hidden="true"/>}
              <div className="bird-overlay">{bird.family && <span className="bird-family">{bird.family}</span>}<span className="overlay-name">{bird.name}</span>{bird.scientificName && <span className="overlay-scientific">{bird.scientificName}</span>}<span className="view-album">View photographs</span></div>
            </div><div className="bird-caption"><h2>{bird.name}</h2><span>{bird.photos.length} {bird.photos.length === 1 ? "photo" : "photos"}</span>{bird.scientificName && <p>{bird.scientificName}</p>}{bird.identificationNote && <small className="provisional-label">Provisional identification</small>}{!bird.identificationNote&&bird.photos.some(p=>p.identificationNote)&&<small className="provisional-label">Photograph needs identification review</small>}{catalogue.canManage&&(pendingAlbums.has(bird.id)||bird.photos.some(p=>pendingPhotos.has(p.id)))&&<small className="draft-badge">Draft changes</small>}{(bird.archivedAt||status==="trash")&&<small className="draft-badge">In Trash</small>}</div>
          </button></article>;
        })}</section>}
        {!visible.length && <div className="no-results"><Feather size={30} aria-hidden="true"/><h2>No albums match those filters.</h2><button onClick={clearFilters}>Clear filters</button></div>}
      </>}
    </main>
    <footer className="site-footer"><Feather size={16} aria-hidden="true"/><span>Photographs by Joseph Botros</span><a href={catalogue.canManage ? "./" : "./?manage=1"}>{catalogue.canManage ? "View published gallery" : "Manage collection"}</a></footer>
    {selectedBird && <PhotoAlbum bird={selectedBird} selectedId={selection.photoId} canManage={catalogue.canManage} albums={catalogue.birds} onMoved={openMapPhoto} onClose={close} onSelect={id => open(selectedBird,id,false)} onAdd={() => setAdding(selectedBird.id)} onReload={reload}/>}
    {adding && <Suspense fallback={<p className="collection-loading">Loading photo importer…</p>}><UploadDialog bird={catalogue.birds.find(bird => bird.id === adding)} onClose={() => setAdding(null)} onRefresh={reload} onComplete={async (birdId,photoId,notice) => {const data = await reload();setAdding(null);setImportNotice(notice||"");const bird=data.birds.find(item => item.id === birdId);if(bird)open(bird,photoId);}}/></Suspense>}
  </>;
}

function PhotoAlbum({bird,selectedId,canManage,albums,onMoved,onClose,onSelect,onAdd,onReload}: {bird:Bird;selectedId:string;canManage:boolean;albums:Bird[];onMoved:(birdId:string,photoId:string)=>void;onClose:()=>void;onSelect:(id:string)=>void;onAdd:()=>void;onReload:()=>Promise<Catalogue>}) {
  const dialog = useRef<HTMLDialogElement>(null), viewport = useRef<HTMLDivElement>(null), viewer = useRef<HTMLDivElement>(null);
  const index = Math.max(0,bird.photos.findIndex(photo => photo.id === selectedId)), photo = bird.photos[index];
  const [zoom,setZoom] = useState(1), [pan,setPan] = useState({x:0,y:0}), [fullWindow,setFullWindow] = useState(false), [nativeFullscreen,setNativeFullscreen] = useState(false);
  const [loadedId,setLoadedId] = useState(""), [failedId,setFailedId] = useState(""), [notice,setNotice] = useState("");
  const [coverBusy,setCoverBusy] = useState(false),[editing,setEditing]=useState(false),[managing,setManaging]=useState(false),[mapOpen,setMapOpen]=useState(false);
  const drag = useRef<{id:number;x:number;y:number;panX:number;panY:number}|null>(null);
  const move = (direction:number) => {const next=bird.photos[index+direction];if(next)onSelect(next.id);};
  const close = () => {if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});onClose();};
  const clampPan = useCallback((value:{x:number;y:number},factor=zoom) => {
    const box=viewport.current?.getBoundingClientRect();if(!box||!photo)return {x:0,y:0};
    const ratio=photo.width/photo.height,width=Math.min(box.width,box.height*ratio),height=width/ratio;
    const maxX=Math.max(0,(width*factor-box.width)/2),maxY=Math.max(0,(height*factor-box.height)/2);
    return {x:Math.min(maxX,Math.max(-maxX,value.x)),y:Math.min(maxY,Math.max(-maxY,value.y))};
  },[zoom,photo]);
  useEffect(() => {if(!dialog.current?.open)dialog.current?.showModal();dialog.current?.querySelector<HTMLButtonElement>(".viewer-close")?.focus();},[bird.id]);
  useEffect(() => {
    const url=new URL(window.location.href);
    if(!canManage||url.searchParams.get("edit")!=="photo")return;
    url.searchParams.delete("edit");window.history.replaceState({},"",url);
    if(url.searchParams.get("bird")===bird.id&&url.searchParams.get("photo")===photo?.id)setEditing(true);
  },[canManage,bird.id,photo?.id]);
  useEffect(() => {setZoom(1);setPan({x:0,y:0});setNotice("");drag.current=null;},[photo?.id]);
  useEffect(() => {
    setPan(value=>clampPan(value));const observer=new ResizeObserver(()=>setPan(value=>clampPan(value)));
    if(viewport.current)observer.observe(viewport.current);return()=>observer.disconnect();
  },[clampPan]);
  useEffect(() => {const sync=()=>setNativeFullscreen(!!document.fullscreenElement);document.addEventListener("fullscreenchange",sync);return()=>document.removeEventListener("fullscreenchange",sync);},[]);
  useEffect(() => {
    const target=viewport.current;const wheel=(event:WheelEvent)=>{if(event.ctrlKey){event.preventDefault();setZoom(value=>Math.max(1,Math.min(6,value*(event.deltaY<0?1.15:.87))));}};
    target?.addEventListener("wheel",wheel,{passive:false});return()=>target?.removeEventListener("wheel",wheel);
  },[]);
  const fullscreen = async () => {
    if(fullWindow){setFullWindow(false);return;}
    try{if(document.fullscreenElement)await document.exitFullscreen();else if(viewer.current?.requestFullscreen)await viewer.current.requestFullscreen();else setFullWindow(true);}catch{setFullWindow(true);}
  };
  const pointerDown = (event:PointerEvent<HTMLDivElement>) => {
    if(zoom<=1||event.button>0||(event.target as HTMLElement).closest("button,a"))return;
    event.preventDefault();drag.current={id:event.pointerId,x:event.clientX,y:event.clientY,panX:pan.x,panY:pan.y};event.currentTarget.setPointerCapture(event.pointerId);
  };
  const setCover = async () => {
    if(!photo)return;setCoverBusy(true);
    try{await stageCover(bird.id,photo.id);await onReload();setNotice("Cover saved to your draft. Publish the draft to update the gallery.");}catch(error){setNotice(error instanceof Error?error.message:"The cover could not be updated.");}finally{setCoverBusy(false);}
  };
  return <><dialog ref={dialog} className={`album-dialog${fullWindow?" viewer-expanded":""}`} aria-labelledby="album-title" onCancel={event=>{event.preventDefault();if(fullWindow)setFullWindow(false);else close();}} onClick={event=>{if(event.target===event.currentTarget)close();}} onKeyDown={event=>{if((event.target as HTMLElement).closest("input,textarea,select"))return;if(event.key==="ArrowLeft"){event.preventDefault();move(-1);}if(event.key==="ArrowRight"){event.preventDefault();move(1);}}}>
    <div className="viewer-shell" ref={viewer}>
      <button className="viewer-close icon-button" aria-label="Close album" onClick={close}><X size={22}/></button>
      <div ref={viewport} className={`image-viewport${zoom>1?" zoomed":""}`} onPointerDown={pointerDown} onPointerMove={event=>{const current=drag.current;if(current&&current.id===event.pointerId)setPan(clampPan({x:current.panX+event.clientX-current.x,y:current.panY+event.clientY-current.y}));}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}>
        {photo ? <img key={photo.id} src={photoUrl(photo)} alt={photo.caption || bird.name} draggable={false} style={{transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}} onLoad={()=>setLoadedId(photo.id)} onError={()=>setFailedId(photo.id)} onDoubleClick={()=>setZoom(value=>value===1?2:1)}/> : <div className="album-empty"><Camera size={40}/><p>This bird&apos;s album is ready for photographs.</p></div>}
        <button className="image-nav image-previous" aria-label="Previous photograph" disabled={index<=0} onClick={()=>move(-1)}>&lt;</button><button className="image-nav image-next" aria-label="Next photograph" disabled={index>=bird.photos.length-1} onClick={()=>move(1)}>&gt;</button>
        {photo && loadedId!==photo.id && failedId!==photo.id && <span className="image-status" role="status">Loading full-size photograph…</span>}
        {photo && failedId===photo.id && <span className="image-status" role="status">This photograph could not be loaded. Try reopening the album.</span>}
      </div>
      <div className="viewer-tools"><button className="zoom-button" aria-label="Zoom out" disabled={!photo||zoom<=1} onClick={()=>setZoom(value=>Math.max(1,value/1.5))}>−</button><span aria-live="polite">{Math.round(zoom*100)}%</span><button className="zoom-button" aria-label="Zoom in" disabled={!photo||zoom>=6} onClick={()=>setZoom(value=>Math.min(6,value*1.5))}>+</button><button onClick={()=>{setZoom(1);setPan({x:0,y:0});}}>Reset</button><button onClick={fullscreen}>{fullWindow||nativeFullscreen?"Exit fullscreen":"Fullscreen"}</button>{photo && <a href={photoUrl(photo)} download={photo.originalName}>Download photo</a>}</div>
    </div>
    <div className="album-info"><div className="album-heading"><div><h2 id="album-title">{bird.name}</h2>{bird.scientificName && <p className="scientific-name">{bird.scientificName}</p>}{bird.family && <span className="family-tag">{bird.family}</span>}</div><div className="album-actions">{canManage && <><button className="primary" onClick={onAdd} disabled={!!bird.archivedAt}><Plus size={17}/> Add photos</button><button onClick={()=>setManaging(true)}>Manage album</button></>}<button onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href);setNotice("Album link copied.");}catch{setNotice("Copy this page's address to share the album.");}}}>Copy album link</button></div></div>
      {bird.identificationNote && <p className="identification-note">{bird.identificationNote}</p>}
      {photo && <div className="photo-details">{photo.caption && <p>{photo.caption}</p>}<div className="photo-metadata"><span><MapPin size={16}/>{photo.location || "Location not recorded"}</span>{photo.gps&&<span>GPS {photo.gps.latitude.toFixed(5)}, {photo.gps.longitude.toFixed(5)}</span>}{photo.capturedOn && <span><CalendarDays size={16}/><time dateTime={photo.capturedOn}>{new Date(photo.capturedOn+"T12:00:00").toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"})}</time></span>}{photo.capturedTime && <span title="Capture time recorded by the camera; no timezone conversion"><Clock3 size={16}/><time>{photo.capturedTime}</time><small>camera time</small></span>}</div>{photo.identificationNote && <p className="identification-note">{photo.identificationNote}</p>}</div>}
      {photo && <div className="photo-edit-actions">{canManage ? <button onClick={()=>setEditing(true)}>Edit photo details</button> : <a className="photo-edit-link" href={`./?${new URLSearchParams({manage:"1",bird:bird.id,photo:photo.id,edit:"photo"})}`}>Edit photo</a>}{canManage && <button className="text-button cover-button" disabled={coverBusy||coverPhoto(bird)?.id===photo.id} onClick={setCover}>{coverPhoto(bird)?.id===photo.id?"Album cover":"Use this as the album cover"}</button>}</div>}
      {canManage&&photo&&<PhotoOrganizer key={photo.id} bird={bird} photo={photo} albums={albums} onReload={onReload} onMoved={onMoved} onRemoved={()=>{const next=bird.photos.find(p=>p.id!==photo.id);if(next)onSelect(next.id);else onClose();}}/>}
      <div className="album-map-toggle"><button onClick={()=>setMapOpen(v=>!v)}>{mapOpen?"Hide species map":"Species heatmap"}</button><span>{bird.photos.filter(p=>!p.trashedAt&&validGPS(p.gps)).length} photographs with GPS</span></div>
      {mapOpen&&<Suspense fallback={<p>Loading species map…</p>}><PhotoMap birds={[bird]} title={bird.name+" locations"} onOpen={(_,id)=>onSelect(id)}/></Suspense>}
      {bird.photos.length>0 && <div className="album-thumbnails" aria-label="Album photographs">{bird.photos.map((item,i)=><button key={item.id} className={item.id===photo?.id?"selected":""} onClick={()=>onSelect(item.id)} aria-label={`View photograph ${i+1} of ${bird.name}`} aria-pressed={item.id===photo?.id}><img src={photoUrl(item,true)} alt="" loading="lazy"/></button>)}</div>}
      <p className="album-notice" role="status">{notice}</p>
    </div>
  </dialog>{managing&&<AlbumManager bird={bird} albums={albums} onClose={()=>setManaging(false)} onReload={onReload} onAlbumClosed={onClose}/>} {editing && photo && <PhotoDetailsDialog photo={photo} onClose={()=>setEditing(false)} onComplete={async()=>{await onReload();setEditing(false);setNotice("Photo details saved to your draft. Publish the draft to update the gallery.");}}/>}</>;
}

