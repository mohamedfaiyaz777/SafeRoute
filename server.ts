import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API: Emergency SOS Dispatch Receiver
  app.post('/api/sos', (req, res) => {
    const { lat, lon, area, audio } = req.body;
    
    console.log('\n=============================================');
    console.log('🚨 EMERGENCY SOS DISPATCH TRIGGERED 🚨');
    console.log('=============================================');
    console.log(`📍 Location: ${lat}, ${lon}`);
    console.log(`🗺️ Approximate Area: ${area}`);
    
    if (audio) {
      // In production, this base64 string would be decoded and sent to emergency services' AWS S3 bucket/Twilio.
      const mbSize = (Buffer.from(audio).length / 1024 / 1024).toFixed(2);
      console.log(`🎙️ Audio Context Attached: YES (${mbSize} MB encoded payload)`);
    } else {
      console.log(`🎙️ Audio Context Attached: NO (Location ping only)`);
    }
    console.log('---------------------------------------------\n');
    
    res.json({ status: 'success', message: 'SOS Alert dispatched successfully to Emergency Response Centers.' });
  });

  // Mathematical Safety Assessment Algorithm (Based on Crime Stats + Safetipin + TN Open Data)
  function calculateSafetyIndex(zone: any) {
    const hour = new Date().getHours();
    
    // 1. Kaggle Crime Data Vector (Historical FIR density)
    // We normalize this out of 10. (In a real DB, this is SUM(crimes_last_30_days) / Area)
    const crimeVector = zone.base_risk || 5; 

    // 2. Safetipin Audit Vector (Lighting, Eyes on the street, Walkpath)
    // Scale 1 to 10 (10 being perfect lighting, 1 being pitch black)
    // Danger zones typically have bad lighting (1-3), Safe zones have good (8-10)
    const safetiPinScore = zone.lighting_score || (crimeVector > 6 ? 2 : 8); 

    // 3. TN Open Data Vector (Police stations, CCTV infrastructure)
    const infrastructureScore = zone.cctv_density || (crimeVector > 6 ? 0 : 10);

    // Dynamic Temporal Constraints (Time of Day Modifier)
    // Safetipin drops dramatically when lighting fails.
    let temporalModifier = 1.0;
    if (hour >= 18 && hour < 22) temporalModifier = 1.6; // Evening twilight drop
    if (hour >= 22 || hour < 5) temporalModifier = 2.8; // Night time isolation

    // The Algorithm: (Crime Weight) - (Infrastructure Shield) + (Safetipin Penalty) * Time
    // W1 = 0.5 (Crime History), W2 = 0.3 (Infrastructure), W3 = 0.2 (Environmental UI)
    
    let baseCalculation = (crimeVector * 0.5) - (infrastructureScore * 0.15) + ((10 - safetiPinScore) * 0.35);
    let finalRisk = Math.max(1, Math.min(10, baseCalculation * temporalModifier)); // Bound between 1 and 10

    return finalRisk.toFixed(1);
  }

  // API: Get Zones with Dynamic Risk
  app.get('/api/zones', (req, res) => {
    const dataPath = path.join(process.cwd(), 'src/mock_data.json');
    const rawData = fs.readFileSync(dataPath, 'utf-8');
    const data = JSON.parse(rawData);

    // Apply multiplier to danger zones using the Data Model
    const modifiedDangerZones = data.danger_zones.map((zone: any) => ({
      ...zone,
      current_risk: calculateSafetyIndex(zone),
      is_extra_risky: new Date().getHours() >= 22 || new Date().getHours() < 5,
      data_sources: ["Kaggle_Crime_FIRs", "Safetipin_Lighting", "TN_OpenData_Infra"]
    }));

    res.json({
      status: 'success',
      safe_zones: data.safe_zones,
      danger_zones: modifiedDangerZones,
      routes: data.routes
    });
  });

  // Haversine Distance Formula
  function getDistanceFromLatLonInKm(lat1: number, lon1: number, lat2: number, lon2: number) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + 
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
              Math.sin(dLon/2) * Math.sin(dLon/2); 
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
    return R * c;
  }

  // API: Evaluate OSRM Routes against Safety Zones
  app.post('/api/route/safety', (req, res) => {
    const { routes } = req.body;
    const dataPath = path.join(process.cwd(), 'src/mock_data.json');
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
    
    const safeZones = data.safe_zones;
    const dangerZones = data.danger_zones;

    const evaluatedRoutes = routes.map((route: any, index: number) => {
      let dangerHits = new Map();
      let safeHits = new Map();
      
      const coordinates = route.geometry.coordinates; // [lng, lat][]

      // Sample coordinates to check against zones
      coordinates.forEach((coord: [number, number]) => {
        const lng = coord[0];
        const lat = coord[1];

        dangerZones.forEach((dz: any) => {
          const dist = getDistanceFromLatLonInKm(lat, lng, dz.latlng[0], dz.latlng[1]);
          const radiusKm = (dz.radius_meters || 150) / 1000;
          if (dist <= radiusKm) dangerHits.set(dz.id, dz);
        });

        safeZones.forEach((sz: any) => {
          const dist = getDistanceFromLatLonInKm(lat, lng, sz.latlng[0], sz.latlng[1]);
          if (dist <= 0.3) safeHits.set(sz.id, sz); // 300m radius for safety buffer
        });
      });

      let safetyScore = 100;
      let reasons: string[] = [];

      dangerHits.forEach((dz) => {
        safetyScore -= (parseInt(dz.base_risk) || 6) * 4;
        reasons.push(`Avoid: Passes near crime hotspot (${dz.name})`);
      });

      safeHits.forEach((sz) => {
        safetyScore += 15;
        reasons.push(`Secured by ${sz.label} (${sz.name})`);
      });

      // Normalize Score
      safetyScore = Math.max(10, Math.min(100, safetyScore));
      
      if (dangerHits.size === 0 && safeHits.size === 0) {
         safetyScore = 75;
         reasons.push("Standard route (Unknown monitoring)");
      }

      return {
        id: index,
        original_route: route,
        safety_score: safetyScore,
        reasons: reasons.slice(0, 2), // Keep UI clean with max 2 reasons
        distance: route.distance,
        duration: route.duration
      };
    });

    res.json({ status: 'success', evaluatedRoutes });
  });

  // SOS Endpoint Mock
  app.post('/api/sos', (req, res) => {
    const { lat, lng } = req.body;
    console.log(`🚨 SOS SIGNAL RECEIVED: ${lat}, ${lng}`);
    res.json({ 
      status: 'success', 
      message: 'SOS Alert Dispatched to Perambur Police Station',
      eta: '4 mins'
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SafeRoute Backend running at http://localhost:${PORT}`);
    console.log(`🌃 Dynamic Risk Scoring active for "After 10 PM" logic.`);
  });
}

startServer();
