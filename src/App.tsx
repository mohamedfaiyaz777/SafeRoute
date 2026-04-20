import { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import { Shield, AlertTriangle, Phone, Navigation, Camera, X, Menu, MapPin, Zap, LocateFixed, Mic, CheckCircle, Plus, Minus, Layers, Maximize, Minimize } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- Types ---
interface Zone {
  id: string;
  name: string;
  latlng: [number, number];
  description: string;
  label?: string;
  cctv_cameras?: number;
  current_risk?: number;
  is_extra_risky?: boolean;
  radius_meters?: number;
}

interface RouteData {
  waypoints: [number, number][];
  duration_min: number;
  distance_km: number;
}

export default function App() {
  const [map, setMap] = useState<L.Map | null>(null);
  const [showSOS, setShowSOS] = useState(false);
  const [sosState, setSosState] = useState<'idle' | 'recording' | 'sending' | 'sent'>('idle');
  const [routed, setRouted] = useState(false);
  const [zones, setZones] = useState<{ safe: Zone[], danger: Zone[] }>({ safe: [], danger: [] });
  const [selectedRoute, setSelectedRoute] = useState<'safe' | 'danger'>('safe');
  const [loading, setLoading] = useState(true);
  const [aiActive, setAiActive] = useState(false);
  const [prediction, setPrediction] = useState<string>("Analyzing...");
  const [startQuery, setStartQuery] = useState("Your Location");
  const [searchQuery, setSearchQuery] = useState("");
  const [isRouting, setIsRouting] = useState(false);
  const [routeOptions, setRouteOptions] = useState<any[]>([]);
  const [activeRouteIndex, setActiveRouteIndex] = useState(0);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationName, setLocationName] = useState<string>("Locating...");
  const [mapStyle, setMapStyle] = useState<'dark' | 'street' | 'satellite'>('dark');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [riskWarning, setRiskWarning] = useState<any | null>(null);
  const [isComparing, setIsComparing] = useState(false);

  const mapRef = useRef<HTMLDivElement>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const webcamRef = useRef<HTMLDivElement>(null);
  const webcamObjRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const activePolylinesRef = useRef<L.Polyline[]>([]);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const lastTapRef = useRef<number>(0);
  const aiSessionRef = useRef<number>(0);

  // --- SOS Double Tap Trigger ---
  useEffect(() => {
    const handleDoubleTap = () => {
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;
      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
        handleTriggerSOS();
      }
      lastTapRef.current = now;
    };

    window.addEventListener('click', handleDoubleTap);
    return () => window.removeEventListener('click', handleDoubleTap);
  }, []);

  const handleTriggerSOS = () => {
    setShowSOS(true);
    setSosState('idle');
    if ('vibrate' in navigator) navigator.vibrate(200);
  };

  // --- AI Scanner Init Effect ---
  useEffect(() => {
    if (!aiActive) {
      if (webcamObjRef.current) {
        webcamObjRef.current.stop();
        webcamObjRef.current = null;
      }
      return;
    }

    let isMounted = true;
    const currentSession = ++aiSessionRef.current;
    
    const startAI = async () => {
      try {
        const tmImage = (window as any).tmImage;
        const modelURL = "https://teachablemachine.withgoogle.com/models/H4U5t8_t3/model.json";
        const metadataURL = "https://teachablemachine.withgoogle.com/models/H4U5t8_t3/metadata.json";
        const model = await tmImage.load(modelURL, metadataURL);
        const webcam = new tmImage.Webcam(300, 300, true);
        await webcam.setup();
        await webcam.play();
        
        if (!isMounted || currentSession !== aiSessionRef.current) {
          webcam.stop();
          return;
        }

        webcamObjRef.current = webcam;
        
        const container = document.getElementById('ai-webcam-container');
        if (container && !container.hasChildNodes()) {
          container.appendChild(webcam.canvas);
        }

        const predictLoop = async () => {
          if (!isMounted || !webcamObjRef.current || currentSession !== aiSessionRef.current) return;
          webcam.update();
          const predictionData = await model.predict(webcam.canvas);
          let best = { className: "Scanning...", probability: 0 };
          predictionData.forEach((p: any) => { if (p.probability > best.probability) best = p; });
          const label = best.className === "Class 1" ? "SAFE ZONE DETECTED" : "HIGH RISK AREA DETECTED";
          setPrediction(`${label} (${Math.round(best.probability * 100)}%)`);
          window.requestAnimationFrame(predictLoop);
        };
        predictLoop();
      } catch (err) {
        console.error("AI Init Error:", err);
        setPrediction("Failed to load camera.");
      }
    };
    
    // Slight delay to allow AnimatePresence and the overlay DOM to mount
    setTimeout(() => {
      if (isMounted) startAI();
    }, 100);

    return () => {
      isMounted = false;
    };
  }, [aiActive]);

  // --- Map Init ---
  useEffect(() => {
    if (!mapRef.current) return;

    let isActive = true;

    const leafletMap = L.map(mapRef.current, {
      center: [13.0827, 80.2707], // Central Chennai
      zoom: 12, // Zoomed out slightly to show all of Chennai
      zoomControl: false,
      attributionControl: false,
    });

    tileLayerRef.current = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
    }).addTo(leafletMap);

    setMap(leafletMap);

    fetch('/api/zones')
      .then(res => res.json())
      .then(data => {
        if (!isActive) return; // Prevent adding to destroyed map
        setZones({ safe: data.safe_zones, danger: data.danger_zones });
        setLoading(false);
        
        data.danger_zones.forEach((z: Zone) => {
          L.circle(z.latlng, {
            radius: z.radius_meters || 100,
            color: '#ef4444',
            weight: 1,
            fillColor: '#ef4444',
            fillOpacity: 0.15,
          }).addTo(leafletMap);

          const icon = L.divIcon({
            className: '',
            html: `<div class="w-8 h-8 rounded-full border border-[#ef4444] bg-black/80 flex items-center justify-center animate-pulse shadow-[0_0_15px_rgba(239,68,68,0.4)] text-[10px]">⚠️</div>`,
            iconSize: [32, 32],
            popupAnchor: [0, -16]
          });

          L.marker(z.latlng, { icon }).addTo(leafletMap)
            .bindPopup(`<div class="bg-black text-white p-3 rounded-xl border border-white/10 font-sans w-48">
              <p class="text-[9px] uppercase tracking-widest text-[#ef4444] font-bold mb-1">Danger Zone</p>
              <p class="font-bold text-sm leading-tight">${z.name}</p>
              <div class="mt-3 bg-white/5 border border-white/10 p-2 rounded-lg">
                <div class="text-[8px] tracking-widest text-white/40 uppercase mb-1">Calculated Risk Index</div>
                <div class="text-xl font-mono font-black text-[#ef4444]">${z.current_risk}<span class="text-xs text-white/30">/10</span></div>
              </div>
              <p class="mt-2 text-[7px] text-white/30 uppercase tracking-widest leading-tight">Calc via: Kaggle Crime, Safetipin, TN OpenData</p>
            </div>`, { className: 'custom-popup' });
        });

        data.safe_zones.forEach((z: Zone) => {
          const icon = L.divIcon({
            className: '',
            html: `<div class="w-8 h-8 rounded-full border border-[#10b981] bg-black/80 flex items-center justify-center shadow-[0_0_15px_rgba(16,185,129,0.3)] text-[10px]">🛡️</div>`,
            iconSize: [32, 32]
          });
          L.marker(z.latlng, { icon }).addTo(leafletMap)
            .bindPopup(`<div class="bg-black text-white p-3 rounded-xl border border-white/10 font-sans">
              <p class="text-[9px] uppercase tracking-widest text-[#10b981] font-bold mb-1">Safe Zone</p>
              <p class="font-bold text-sm leading-tight">${z.name}</p>
              <div class="mt-2 text-[9px] font-mono opacity-50 uppercase">CCTV Secured</div>
            </div>`, { className: 'custom-popup' });
        });
      });

    return () => {
      isActive = false;
      leafletMap.remove();
      setMap(null);
    };
  }, []);

  // --- Map Controls Effect ---
  useEffect(() => {
    if (!map || !tileLayerRef.current) return;
    
    let url = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    let subdomains = 'abcd';
    let maxZoom = 20;

    if (mapStyle === 'street') {
      url = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
      subdomains = 'abc';
    } else if (mapStyle === 'satellite') {
      url = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      subdomains = 'abc';
    }

    tileLayerRef.current.setUrl(url);
  }, [mapStyle, map]);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  const handleZoomIn = () => map?.zoomIn();
  const handleZoomOut = () => map?.zoomOut();

  // --- Audio SOS Handlers ---
  const sendSOSAlert = async (audioBase64: string | ArrayBuffer | null = null) => {
    setSosState('sending');
    try {
      await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: userLocation ? userLocation[0] : 13.0785,
          lon: userLocation ? userLocation[1] : 80.2585,
          area: locationName,
          audio: audioBase64
        })
      });
      setSosState('sent');
    } catch (e) {
      console.error("SOS Trigger failed", e);
      alert("Network failed. Connecting you to 100 directly...");
      setSosState('idle');
      window.location.href = "tel:100";
    }
  };

  const startAudioRecord = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          await sendSOSAlert(reader.result);
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setSosState('recording');
      
      // Auto-stop after 10s to ensure dispatch occurs
      setTimeout(() => {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
      }, 10000);
    } catch (err) {
      console.warn("Michrophone blocked", err);
      alert("Microphone permission denied. Dispatching silent location SOS.");
      sendSOSAlert(null);
    }
  };

  const stopAudioAndSend = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  };

  const handleRouteSelect = (routes: any[], idx: number) => {
    setActiveRouteIndex(idx);
    drawAllRoutes(routes, idx);
    const selected = routes[idx];
    if (selected && selected.safety_score < 50) {
      setRiskWarning(selected);
    }
  };

  const drawAllRoutes = (routesToDraw: any[], activeIdx: number) => {
    if (!map) return;
    setRouted(true);

    // Clear old routes
    activePolylinesRef.current.forEach(p => p.remove());
    activePolylinesRef.current = [];

    if (routesToDraw.length === 0) return;

    // Routes are sorted descending by safety_score:
    //   index 0  → safest  (green)
    //   last idx → shortest / most dangerous (red, "Unsafe")
    const safestIdx = 0;
    const unsafeIdx = routesToDraw.length - 1;

    // 1. Draw any intermediate routes underneath (dimmed slate)
    routesToDraw.forEach((routeOb, idx) => {
      if (idx === safestIdx || idx === unsafeIdx) return;
      const coords = routeOb.original_route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
      const poly = L.polyline(coords, { color: '#64748b', weight: 3, opacity: 0.3 }).addTo(map);
      poly.on('click', () => handleRouteSelect(routesToDraw, idx));
      activePolylinesRef.current.push(poly);
    });

    // 2. Draw the UNSAFE (shortest / least safe) route in red underneath
    const unsafeRoute = routesToDraw[unsafeIdx];
    if (unsafeRoute) {
      const coords = unsafeRoute.original_route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
      const redPoly = L.polyline(coords, {
        color: '#ef4444',
        weight: 4,
        opacity: 0.85,
        dashArray: '10 8',
      }).addTo(map);

      redPoly.bindPopup(`
        <div style="background:#0a0a0a;color:#fff;padding:12px 14px;border-radius:14px;border:1px solid rgba(239,68,68,0.4);font-family:sans-serif;min-width:180px;">
          <p style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#ef4444;font-weight:800;margin-bottom:6px;">⚠️ Unsafe Route</p>
          <p style="font-weight:700;font-size:13px;margin-bottom:8px;">Shortest but Risky</p>
          <p style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;">Passes through documented crime hotspots. Not recommended — especially after dark.</p>
          <div style="margin-top:10px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:8px 10px;">
            <div style="font-size:8px;letter-spacing:1.5px;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-bottom:2px;">Safety Score</div>
            <div style="font-size:20px;font-weight:900;color:#ef4444;font-family:monospace;">${unsafeRoute.safety_score}%</div>
          </div>
        </div>`, { className: 'custom-popup' });

      redPoly.on('click', () => handleRouteSelect(routesToDraw, unsafeIdx));
      activePolylinesRef.current.push(redPoly);
    }

    // 3. Draw the SAFEST route in green on top
    const safeRoute = routesToDraw[safestIdx];
    if (safeRoute) {
      const coords = safeRoute.original_route.geometry.coordinates.map((c: any) => [c[1], c[0]]);
      const greenPoly = L.polyline(coords, {
        color: '#10b981',
        weight: 6,
        opacity: 1,
      }).addTo(map);

      greenPoly.bindPopup(`
        <div style="background:#0a0a0a;color:#fff;padding:12px 14px;border-radius:14px;border:1px solid rgba(16,185,129,0.4);font-family:sans-serif;min-width:180px;">
          <p style="font-size:9px;letter-spacing:2px;text-transform:uppercase;color:#10b981;font-weight:800;margin-bottom:6px;">🛡️ Recommended</p>
          <p style="font-weight:700;font-size:13px;margin-bottom:8px;">Safest Route</p>
          <p style="font-size:11px;color:rgba(255,255,255,0.5);line-height:1.5;">Passes through CCTV-covered and police-secured zones.</p>
          <div style="margin-top:10px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:8px 10px;">
            <div style="font-size:8px;letter-spacing:1.5px;color:rgba(255,255,255,0.35);text-transform:uppercase;margin-bottom:2px;">Safety Score</div>
            <div style="font-size:20px;font-weight:900;color:#10b981;font-family:monospace;">${safeRoute.safety_score}%</div>
          </div>
        </div>`, { className: 'custom-popup' });

      greenPoly.on('click', () => handleRouteSelect(routesToDraw, safestIdx));
      activePolylinesRef.current.push(greenPoly);

      // Fit map to show both routes
      const allCoords = [
        ...routesToDraw[safestIdx].original_route.geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]),
        ...(unsafeRoute ? unsafeRoute.original_route.geometry.coordinates.map((c: any) => [c[1], c[0]] as [number, number]) : []),
      ];
      map.fitBounds(L.latLngBounds(allCoords), { padding: [60, 60] });
    }
  };

  const reverseGeocode = async (lat: number, lon: number) => {
    try {
      const gRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
      const gData = await gRes.json();
      if (gData && gData.address) {
        const area = gData.address.suburb || gData.address.neighbourhood || gData.address.city_district || "Unknown Area";
        setLocationName(`Live: ${area}`);
      } else {
        setLocationName("Live: Coordinates Found");
      }
    } catch (e) {
      setLocationName("Live: GPS Active");
    }
  };

  const handleLocateMe = async () => {
    if (!map) return;
    setLocationName("Acquiring GPS...");
    try {
      const coords = await getUserLocation();
      setUserLocation(coords);
      
      map.flyTo(coords, 16, { animate: true, duration: 1.5 });
      
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(coords);
      } else {
        const icon = L.divIcon({
            className: '',
            html: `<div class="w-6 h-6 rounded-full border-2 border-white bg-[#3b82f6] shadow-[0_0_20px_rgba(59,130,246,0.8)] pointer-events-none relative"><div class="absolute inset-0 rounded-full border border-[#3b82f6] animate-ping" style="animation-duration: 2s;"></div></div>`,
            iconSize: [24, 24]
        });
        userMarkerRef.current = L.marker(coords, { icon }).addTo(map);
      }
      
      await reverseGeocode(coords[0], coords[1]);
    } catch (err) {
      alert("Please allow location tracking in your browser to use SafeRoute Navigation.");
      setLocationName("Location Blocked");
    }
  };

  const getUserLocation = (): Promise<[number, number]> => {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not supported by this browser."));
      } else {
        navigator.geolocation.getCurrentPosition(
          (position) => resolve([position.coords.latitude, position.coords.longitude]),
          (error) => reject(error),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    });
  };

  const handleSearch = async (e: any) => {
    e.preventDefault();
    if (!searchQuery || !startQuery) return;
    setIsRouting(true);
    setRouted(true);
    
    try {
      let startLat: number;
      let startLon: number;

      // 1. Resolve Start Location
      if (startQuery.toLowerCase() === 'your location') {
        if (userLocation) {
          startLat = userLocation[0];
          startLon = userLocation[1];
        } else {
          try {
            const coords = await getUserLocation();
            startLat = coords[0];
            startLon = coords[1];
            setUserLocation(coords);

            if (map) {
              if (userMarkerRef.current) {
                userMarkerRef.current.setLatLng(coords);
              } else {
                const icon = L.divIcon({
                    className: '',
                    html: `<div class="w-6 h-6 rounded-full border-2 border-white bg-[#3b82f6] shadow-[0_0_20px_rgba(59,130,246,0.8)] pointer-events-none relative"><div class="absolute inset-0 rounded-full border border-[#3b82f6] animate-ping" style="animation-duration: 2s;"></div></div>`,
                    iconSize: [24, 24]
                });
                userMarkerRef.current = L.marker(coords, { icon }).addTo(map);
              }
            }
            await reverseGeocode(coords[0], coords[1]);
          } catch (locErr) {
            console.warn("Location error, fallback to Egmore", locErr);
            startLat = 13.0785;
            startLon = 80.2585;
            setStartQuery("Egmore, Chennai");
          }
        }
      } else {
        // Geocode custom start location
        const startGeocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(startQuery + ', Chennai')}&limit=1`;
        const startRes = await fetch(startGeocodeUrl);
        const startData = await startRes.json();
        if (startData && startData.length > 0) {
          startLat = parseFloat(startData[0].lat);
          startLon = parseFloat(startData[0].lon);
        } else {
          alert("Start location not found in Chennai.");
          setIsRouting(false);
          return;
        }
      }

      // 2. Geocode Destination using Nominatim (OpenStreetMap)
      const geocodeUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery + ', Chennai')}&limit=1`;
      const geocodeRes = await fetch(geocodeUrl);
      const geocodeData = await geocodeRes.json();
      
      if (!geocodeData || geocodeData.length === 0) {
         alert("Destination not found in Chennai."); 
         setIsRouting(false); 
         return;
      }
      
      const destLat = parseFloat(geocodeData[0].lat);
      const destLon = parseFloat(geocodeData[0].lon);
      
      // 3. OSRM Dynamic Routing Api (Point-A to Point-B)
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${startLon},${startLat};${destLon},${destLat}?overview=full&geometries=geojson&alternatives=true`;
      const osrmRes = await fetch(osrmUrl);
      const osrmData = await osrmRes.json();

      if (osrmData.routes && osrmData.routes.length > 0) {
         // 3. Mathematical Safety Evaluation via Backend API
         const evalRes = await fetch('/api/route/safety', {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ routes: osrmData.routes })
         });
         const evalData = await evalRes.json();
         
         const evaluated = evalData.evaluatedRoutes.sort((a: any, b: any) => b.safety_score - a.safety_score);
         
         setRouteOptions(evaluated);
         handleRouteSelect(evaluated, 0);
      }
    } catch (err) {
      console.error(err);
      alert("Error finding route.");
    }
    setIsRouting(false);
  };

  return (
    <div className="relative w-full h-screen bg-[#050507] text-white overflow-hidden font-sans">
      <AnimatePresence>
        {loading && (
          <motion.div exit={{ opacity: 0 }} className="absolute inset-0 z-[1000] bg-[#050507] flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-2 border-[#10b981] rounded-full animate-ping flex items-center justify-center">🛡️</div>
            <h1 className="text-xl font-bold tracking-tighter mt-6 uppercase">SafeRoute <span className="text-[#10b981]">Active</span></h1>
            <div className="w-48 h-[1px] bg-white/10 mt-4 overflow-hidden"><motion.div initial={{ x: -200 }} animate={{ x: 200 }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-20 h-full bg-[#10b981]" /></div>
          </motion.div>
        )}
      </AnimatePresence>

      <div ref={mapRef} className="absolute inset-0 z-0 opacity-80" />

      {/* Grid Pattern Overlay */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20" style={{ backgroundImage: 'radial-gradient(#1e293b 1px, transparent 0)', backgroundSize: '24px 24px' }} />

      {/* Top UI Overlay */}
      <div className="relative z-10 p-6 pt-10 pointer-events-none">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 flex justify-center w-full z-20 pointer-events-none">
          <div className="bg-black/80 backdrop-blur-md border border-white/10 px-4 py-2 rounded-full flex items-center gap-2 shadow-2xl">
            <span className="text-[11px] text-white/80 font-bold tracking-wide flex items-center gap-1.5"><MapPin size={12} className="text-[#3b82f6]" /> {locationName}</span>
          </div>
        </div>
        
        <div className="flex justify-between items-center relative z-10 pt-12">
          <div className="bg-black/60 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2 pointer-events-auto">
            <div className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />
            <span className="text-[10px] text-[#10b981] font-bold uppercase tracking-widest">SafeRoute Active</span>
          </div>
          <div className="text-white/40 text-[10px] font-mono tracking-tighter pointer-events-auto">{new Date().getHours()}:{new Date().getMinutes().toString().padStart(2, '0')} PM</div>
        </div>

        <div className="mt-4 flex flex-col gap-2 max-w-sm w-full mx-auto sm:mx-0 pointer-events-auto">
          {/* Start Location Input */}
          <div className="bg-black/90 backdrop-blur-xl border border-white/10 p-2 rounded-2xl shadow-2xl flex items-center gap-2 pointer-events-auto">
            <div className="bg-white/5 p-2 rounded-xl">
              <div className="w-4 h-4 rounded-full border-2 border-[#10b981]" />
            </div>
            <input 
              type="text" 
              placeholder="Start Location (or 'Your Location')..."
              value={startQuery}
              onChange={e => setStartQuery(e.target.value)}
              className="bg-transparent border-none outline-none text-sm font-medium w-full text-white placeholder-white/30"
            />
          </div>

          {/* Destination Input */}
          <div className="bg-black/90 backdrop-blur-xl border border-white/10 p-2 rounded-2xl shadow-2xl flex items-center gap-2 pointer-events-auto">
            <div className="bg-white/5 p-2 rounded-xl">
              <MapPin size={16} className="text-white/40" />
            </div>
            <input 
              id="destination-input"
              type="text" 
              placeholder="Search destination in Chennai..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSearch(e);
                }
              }}
              className="bg-transparent border-none outline-none text-sm font-medium w-full text-white placeholder-white/30"
            />
            <button 
              id="search-button"
              disabled={isRouting} 
              type="button" 
              onClick={handleSearch}
              className="bg-[#10b981] text-black w-10 h-10 rounded-xl flex items-center justify-center shrink-0 hover:bg-[#059669] transition-colors"
            >
              {isRouting ? <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Navigation size={16} fill="black" />}
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Bottom Bar */}
      <div className="absolute bottom-0 left-0 right-0 z-20 pb-10 pt-10 px-8 bg-gradient-to-t from-[#050507] via-[#050507]/90 to-transparent flex flex-col items-end pointer-events-none">
        <div className="flex flex-col gap-4 mb-6">
            
            {/* Custom Map Controls */}
            <div className="flex flex-col items-center bg-black/80 backdrop-blur-lg rounded-2xl border border-white/10 shadow-lg pointer-events-auto overflow-hidden">
               <button onClick={handleZoomIn} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 transition-colors border-b border-white/5 active:bg-white/20">
                 <Plus size={18} className="text-white/80" />
               </button>
               <button onClick={handleZoomOut} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 transition-colors border-b border-white/5 active:bg-white/20">
                 <Minus size={18} className="text-white/80" />
               </button>
               <button onClick={() => setMapStyle(prev => prev === 'dark' ? 'street' : (prev === 'street' ? 'satellite' : 'dark'))} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 transition-colors border-b border-white/5 active:bg-white/20 relative group">
                 <Layers size={18} className={mapStyle === 'dark' ? 'text-white/80' : 'text-[#3b82f6] drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]'} />
               </button>
               <button onClick={toggleFullscreen} className="w-12 h-12 flex items-center justify-center hover:bg-white/10 transition-colors active:bg-white/20">
                 {isFullscreen ? <Minimize size={18} className="text-white/80" /> : <Maximize size={18} className="text-white/80" />}
               </button>
            </div>

            {/* Action Buttons */}
            <button 
                onClick={handleLocateMe}
                className="w-12 h-12 bg-black/80 backdrop-blur-lg rounded-2xl flex flex-col items-center justify-center shadow-lg border border-white/10 active:scale-95 transition-transform pointer-events-auto self-end"
            >
                <LocateFixed size={20} className="text-[#3b82f6]" />
            </button>
            <button 
                onClick={() => setShowSOS(true)} 
                className="w-16 h-16 bg-[#ef4444] rounded-2xl flex flex-col items-center justify-center shadow-[0_0_25px_rgba(239,68,68,0.4)] border border-red-400/30 active:scale-95 transition-transform pointer-events-auto"
            >
                <span className="text-white font-black text-sm uppercase">SOS</span>
                <span className="text-white/60 text-[7px] font-bold uppercase tracking-tighter">Tap 2x</span>
            </button>
        </div>

        {routeOptions.length > 0 && (
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="mt-4 flex flex-col gap-2 max-h-[30vh] overflow-y-auto w-full pointer-events-auto">
                <div className="flex justify-between items-center px-2 mb-1">
                    <div className="text-[10px] text-white/40 uppercase tracking-widest font-bold">Available Routes Formulated</div>
                    {routeOptions.length > 1 && (
                        <button 
                            onClick={() => setIsComparing(true)}
                            className="text-[10px] text-[#3b82f6] uppercase tracking-widest font-black flex items-center gap-1 hover:opacity-80 transition-opacity"
                        >
                            <Zap size={10} fill="currentColor" /> Compare
                        </button>
                    )}
                </div>
                {routeOptions.map((route, idx) => {
                    const isSafest = idx === 0;
                    const isUnsafe = idx === routeOptions.length - 1 && routeOptions.length > 1;
                    const isSafe = route.safety_score >= 80;
                    const isMed = route.safety_score >= 50 && route.safety_score < 80;
                    const colorScore = isSafe ? 'text-[#10b981]' : (isMed ? 'text-[#f59e0b]' : 'text-[#ef4444]');
                    const borderScore = isSafest ? 'border-[#10b981]/40' : isUnsafe ? 'border-[#ef4444]/40' : (isMed ? 'border-[#f59e0b]/30' : 'border-white/10');
                    const bgScore = isSafest ? 'bg-[#10b981]/10' : isUnsafe ? 'bg-[#ef4444]/10' : (isMed ? 'bg-[#f59e0b]/10' : 'bg-black/40');

                    return (
                        <div
                            key={route.id}
                            onClick={() => handleRouteSelect(routeOptions, idx)}
                            className={`w-full p-4 rounded-2xl border cursor-pointer transition-all ${activeRouteIndex === idx ? `${borderScore} ${bgScore}` : 'border-white/10 bg-black/40 hover:bg-white/5'}`}
                        >
                            <div className="flex justify-between items-center mb-2">
                                <div className="text-white font-bold tracking-tight text-sm flex items-center gap-2 flex-wrap">
                                    {isSafest
                                      ? <Shield size={13} className="text-[#10b981] shrink-0" />
                                      : isUnsafe
                                        ? <AlertTriangle size={13} className="text-[#ef4444] shrink-0" />
                                        : null}
                                    {(route.duration / 60).toFixed(0)} MINS
                                    <span className="text-[10px] font-mono text-white/30 font-medium">({(route.distance / 1000).toFixed(1)} km)</span>
                                    {isSafest && (
                                      <span className="text-[8px] font-black tracking-widest uppercase bg-[#10b981]/20 text-[#10b981] px-2 py-0.5 rounded-full border border-[#10b981]/30">
                                        ✅ SAFEST
                                      </span>
                                    )}
                                    {isUnsafe && (
                                      <span className="text-[8px] font-black tracking-widest uppercase bg-[#ef4444]/20 text-[#ef4444] px-2 py-0.5 rounded-full border border-[#ef4444]/30 animate-pulse">
                                        ⚠️ UNSAFE
                                      </span>
                                    )}
                                </div>
                                <div className={`text-[11px] font-black tracking-widest uppercase ${colorScore} shrink-0`}>
                                    {route.safety_score}% SAFE
                                </div>
                            </div>
                            <div className="flex flex-col gap-1">
                                {route.reasons.map((r: string, rIdx: number) => (
                                    <div key={rIdx} className="text-[9px] text-white/50 tracking-wide flex items-center gap-1.5 uppercase font-medium">
                                        <div className={`w-1 h-1 rounded-full shrink-0 ${r.includes('Avoid') ? 'bg-[#ef4444]' : 'bg-[#10b981]'}`}></div>
                                        {r}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )
                })}
            </motion.div>
        )}
        
        <div className="w-20 h-[3px] bg-white/10 rounded-full mx-auto mt-6"></div>
      </div>

      {/* SOS Modal */}
      <AnimatePresence>
        {showSOS && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[500] bg-[#050507]/90 backdrop-blur-xl flex items-end p-6 pb-12" onClick={() => { if (sosState === 'idle') setShowSOS(false); }}>
            <motion.div initial={{ y: 100 }} animate={{ y: 0 }} exit={{ y: 100 }} className="w-full max-w-sm mx-auto bg-black border border-red-500/30 rounded-[32px] p-8 shadow-[0_0_50px_rgba(239,68,68,0.2)]" onClick={e => e.stopPropagation()}>
              
              {sosState === 'idle' && (
                <>
                  <div className="flex flex-col items-center text-center mb-8">
                    <div className="w-16 h-16 bg-red-500/20 border border-red-500/40 rounded-3xl flex items-center justify-center text-3xl mb-4 shadow-[0_0_30px_rgba(239,68,68,0.3)]">🚨</div>
                    <h2 className="text-2xl font-black text-red-500 uppercase tracking-tighter">Emergency SOS</h2>
                    <p className="text-[10px] text-white/40 uppercase tracking-widest mt-2 flex items-center justify-center gap-1"><MapPin size={10} /> {locationName}</p>
                  </div>
                  
                  <button onClick={startAudioRecord} className="w-full bg-[#ef4444] text-white py-4 rounded-2xl mb-4 font-bold flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(239,68,68,0.3)] active:scale-95 transition-transform">
                    <Mic size={18} fill="currentColor" /> Record Context & Dispatch
                  </button>

                  <button onClick={() => sendSOSAlert(null)} className="w-full bg-red-900/40 text-white/80 py-4 rounded-2xl mb-6 font-bold flex items-center justify-center gap-2 border border-red-500/30 active:scale-95 transition-transform">
                    <AlertTriangle size={18} /> Dispatch Location Only
                  </button>

                  <div className="grid grid-cols-2 gap-4 mb-8">
                    <a href="tel:100" className="bg-[#1a1a1e] border border-white/5 p-4 rounded-2xl flex flex-col items-center gap-1 group active:bg-red-500/20">
                      <span className="text-white group-active:text-red-500 group-active:scale-110 transition-all font-mono text-lg font-bold">100</span>
                      <span className="text-[8px] text-white/30 uppercase tracking-widest font-bold">Police</span>
                    </a>
                    <a href="tel:1091" className="bg-[#1a1a1e] border border-white/5 p-4 rounded-2xl flex flex-col items-center gap-1 group active:bg-red-500/20">
                      <span className="text-white group-active:text-red-500 group-active:scale-110 transition-all font-mono text-lg font-bold">1091</span>
                      <span className="text-[8px] text-white/30 uppercase tracking-widest font-bold">Women Help</span>
                    </a>
                  </div>

                  <button onClick={() => setShowSOS(false)} className="w-full py-4 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black tracking-widest opacity-40 uppercase active:scale-95 transition-transform">Abort Signal</button>
                </>
              )}

              {sosState === 'recording' && (
                <div className="flex flex-col items-center py-6 text-center">
                   <motion.div animate={{ scale: [1, 1.15, 1], boxShadow: ["0px 0px 0px rgba(239,68,68,0)", "0px 0px 40px rgba(239,68,68,0.5)", "0px 0px 0px rgba(239,68,68,0)"] }} transition={{ repeat: Infinity, duration: 1.5 }} className="w-24 h-24 bg-red-500/20 border border-red-500 text-red-500 rounded-full flex items-center justify-center mb-6">
                     <Mic size={36} fill="currentColor" />
                   </motion.div>
                   <h3 className="text-xl font-black text-red-500 uppercase tracking-tighter">Recording Context</h3>
                   <p className="text-white/50 text-[10px] uppercase tracking-widest mt-2 mb-8">Speak clearly. Auto-sends in 10s.</p>
                   <button onClick={stopAudioAndSend} className="w-full bg-white text-red-600 py-4 rounded-2xl font-bold uppercase tracking-widest text-sm shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-95 transition-transform">
                     Send Now
                   </button>
                </div>
              )}

              {sosState === 'sending' && (
                <div className="flex flex-col items-center py-12 text-center">
                   <div className="w-16 h-16 border-4 border-white/10 border-t-red-500 rounded-full animate-spin mb-6"></div>
                   <h3 className="text-xl font-black text-white uppercase tracking-tighter">Transmitting SOS</h3>
                   <p className="text-white/50 text-[10px] uppercase tracking-widest mt-2">Sending coordinates & audio...</p>
                </div>
              )}

              {sosState === 'sent' && (
                <div className="flex flex-col items-center py-10 text-center">
                   <CheckCircle size={64} className="text-[#10b981] mb-6 shadow-[0_0_30px_rgba(16,185,129,0.3)] rounded-full" />
                   <h3 className="text-xl font-black text-white uppercase tracking-tighter">SOS Dispatched</h3>
                   <p className="text-white/50 text-[10px] uppercase tracking-widest mt-2">Help is being routed to your location.</p>
                   <button onClick={() => setShowSOS(false)} className="mt-8 bg-white/10 border border-white/10 text-white w-full py-4 rounded-2xl font-bold uppercase tracking-widest text-xs active:scale-95 transition-transform">
                     Return to Map
                   </button>
                </div>
              )}

            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* High Risk Overlay */}
      <AnimatePresence>
        {riskWarning && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-[600] bg-red-950/80 backdrop-blur-md flex flex-col justify-center items-center p-6" onClick={() => setRiskWarning(null)}>
            <motion.div initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }} className="w-full max-w-sm border border-red-500/50 bg-[#0a0a0a] rounded-[32px] p-8 shadow-[0_0_100px_rgba(239,68,68,0.4)] relative overflow-hidden" onClick={e => e.stopPropagation()}>
               <div className="absolute top-0 left-0 right-0 h-1 bg-red-500" />
               <div className="flex flex-col items-center text-center">
                  <div className="w-20 h-20 bg-red-500/10 border border-red-500/30 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <AlertTriangle size={40} className="text-red-500" />
                  </div>
                  <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">High Risk <span className="text-red-500">Route</span></h2>
                  <div className="bg-red-500/20 text-red-500 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-6">Score: {riskWarning.safety_score}%</div>
                  
                  <p className="text-white/60 text-sm leading-relaxed mb-6 font-medium">
                    This route intersects multiple documented danger zones. Historical data indicates poor lighting and high isolation during current hours.
                  </p>

                  <div className="w-full flex flex-col gap-2">
                     <button onClick={() => setRiskWarning(null)} className="w-full py-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-widest text-sm shadow-[0_0_15px_rgba(239,68,68,0.5)] active:scale-95 transition-all">
                       Proceed Anyway
                     </button>
                     <button onClick={() => {
                       // switch to the safest route instead
                       setRiskWarning(null);
                       if (routeOptions.length > 0) {
                          handleRouteSelect(routeOptions, 0); // index 0 is always the safest due to earlier sort
                       }
                     }} className="w-full py-4 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold uppercase tracking-widest text-sm active:scale-95 transition-all">
                       Switch to Safest
                     </button>
                  </div>
               </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Comparison Modal */}
      <AnimatePresence>
        {isComparing && routeOptions.length >= 2 && (() => {
            const safest = routeOptions[0];
            const fastest = [...routeOptions].sort((a,b) => a.duration - b.duration)[0];
            
            return (
              <motion.div 
                initial={{ opacity: 0 }} 
                animate={{ opacity: 1 }} 
                exit={{ opacity: 0 }} 
                className="absolute inset-0 z-[700] bg-[#050507] flex flex-col p-6 overflow-y-auto"
              >
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-2xl font-black uppercase tracking-tighter">Route <span className="text-[#3b82f6]">Comparison</span></h2>
                    <button onClick={() => setIsComparing(false)} className="bg-white/5 p-2 rounded-full border border-white/10">
                        <X size={20} />
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1">
                    {[
                        { title: 'Safest Strategy', icon: <Shield className="text-[#10b981]" />, route: safest, color: '#10b981' },
                        { title: 'Fastest Strategy', icon: <Zap className="text-[#f59e0b]" />, route: fastest, color: '#f59e0b' }
                    ].map((col, i) => (
                        <div key={i} className={`p-6 rounded-[32px] border ${i === 0 ? 'border-[#10b981]/20 bg-[#10b981]/5' : 'border-[#f59e0b]/20 bg-[#f59e0b]/5'} flex flex-col h-full`}>
                            <div className="flex items-center gap-3 mb-6">
                                <div className="p-3 bg-black/40 rounded-2xl border border-white/5">
                                    {col.icon}
                                </div>
                                <div className="text-lg font-black uppercase tracking-tighter">{col.title}</div>
                            </div>

                            <div className="grid grid-cols-2 gap-3 mb-8">
                                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                                    <div className="text-[9px] text-white/30 uppercase font-black mb-1">Time</div>
                                    <div className="text-xl font-black">{(col.route.duration/60).toFixed(0)}m</div>
                                </div>
                                <div className="bg-black/40 p-4 rounded-2xl border border-white/5">
                                    <div className="text-[9px] text-white/30 uppercase font-black mb-1">Safety</div>
                                    <div className={`text-xl font-black ${col.route.safety_score >= 80 ? 'text-[#10b981]' : (col.route.safety_score >= 50 ? 'text-[#f59e0b]' : 'text-[#ef4444]')}`}>
                                        {col.route.safety_score}%
                                    </div>
                                </div>
                                <div className="bg-black/40 p-4 rounded-2xl border border-white/5 col-span-2">
                                    <div className="text-[9px] text-white/30 uppercase font-black mb-1">Distance</div>
                                    <div className="text-xl font-black">{(col.route.distance/1000).toFixed(1)} km</div>
                                </div>
                            </div>

                            <div className="flex-1">
                                <div className="text-[10px] text-white/40 uppercase font-black mb-3 px-1 tracking-widest">Encountered Factors</div>
                                <div className="flex flex-col gap-2">
                                    {col.route.reasons.map((r: string, ridx: number) => (
                                        <div key={ridx} className="text-xs bg-black/20 p-3 rounded-xl border border-white/5 flex items-center gap-2">
                                            <div className={`w-1.5 h-1.5 rounded-full ${r.toLowerCase().includes('avoid') || r.includes('Warning') ? 'bg-[#ef4444]' : 'bg-[#10b981]'}`} />
                                            <span className="opacity-70 font-medium">{r}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <button 
                                onClick={() => {
                                    handleRouteSelect(routeOptions, routeOptions.indexOf(col.route));
                                    setIsComparing(false);
                                }}
                                className="mt-8 w-full py-4 rounded-2xl font-black uppercase text-sm tracking-widest bg-white text-black active:scale-95 transition-transform"
                            >
                                Select This Route
                            </button>
                        </div>
                    ))}
                </div>
              </motion.div>
            );
        })()}
      </AnimatePresence>

      <style>{`
        @keyframes scan-line {
          0% { top: 0%; }
          100% { top: 100%; }
        }
        .custom-popup .leaflet-popup-content-wrapper {
            background: transparent !important;
            box-shadow: none !important;
        }
        .custom-popup .leaflet-popup-tip-container {
            display: none !important;
        }
      `}</style>
    </div>
  );
}
