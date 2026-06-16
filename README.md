<div align="center">
 
# 🛡️ SafeRoute
### Premium Mobile-First Women's Safety Navigator
**Real-time risk scoring | AI Vision Scanning | Emergency SOS**

[View in AI Studio](https://ai.studio/apps/ab8a0833-ec44-4f57-b608-03ea69b16de5)
</div>

---

## 🚀 Overview
SafeRoute is a state-of-the-art navigation tool designed specifically for women's safety in urban environments. It doesn't just find the shortest path; it finds the **safest** path by analyzing historical crime data, lighting infrastructure, and real-time community audits.

## ✨ Core Features

- **🛡️ Smart Safety Routing**: Automatically calculates and recommends routes based on a 1-100% Safety Score.
- **🚨 Double-Tap SOS**: A discreet, system-wide double-tap gesture that immediately records audio context and dispatches GPS location to emergency services.
- **👁️ AI Vision Scanner**: Integrated Teachable Machine model that uses your camera to identify safety markers (safe zones vs. high-risk areas) in real-time.
- **🌃 Dynamic Night Risk**: Risk scores automatically adjust after 10 PM to account for reduced visibility and increased isolation.
- **🎙️ Audio Context Dispatch**: SOS alerts include a 10-second audio recording to provide dispatchers with immediate situational awareness.

## 🧠 The Safety Algorithm
SafeRoute uses a multi-vector risk assessment system:

$$ \text{Risk Index} = (\text{CrimeDensity} \times 0.5) - (\text{InfraShield} \times 0.15) + (\text{DarknessPenalty} \times 0.35) $$

*   **Kaggle Crime FIRs**: Historical density of reported incidents.
*   **Safetipin Data**: Real-time lighting, visibility, and "eyes on the street" scores.
*   **TN Open Data**: Infrastructure placement including CCTV and Police outposts.

## 🛠️ Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS 4
- **Animations**: Motion (formerly Framer Motion)
- **Mapping**: Leaflet.js with Custom GeoJSON Layers
- **Backend**: Node.js + Express (Vite Middleware Mode)
- **AI**: Google Teachable Machine / TensorFlow.js

## 📦 Local Setup

**Prerequisites:** Node.js (v18+)

1. **Clone & Install**:
   ```bash
   npm install
   ```

2. **Configure Environment**:
   Create a `.env.local` file and add your Gemini API key:
   ```env
   GEMINI_API_KEY=your_key_here
   ```

3. **Run Development Server**:
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) to view the app.

## 📄 License
Distributed under the **Apache License 2.0**. See `LICENSE` for more information.

---
<div align="center">
Built with ❤️ for a safer tomorrow.
</div>
 
