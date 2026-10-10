# JJFit & MealPilot Architecture Overview

This document provides a high-level architectural overview of the **JJFit** mobile application ecosystem integrated with the **MealPilot** backend service.

---

## 1. High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph Client["Mobile Client Layer"]
        JJFit["📱 JJFit Mobile App<br/>(iOS & Android)<br/>- User Health Profile<br/>- Blood Pressure & Allergies<br/>- Video Playback & Feed"]
    end

    subgraph Backend["MealPilot Backend (NestJS Service)"]
        API["REST API Layer<br/>(/api/meal-plan)"]
        MealPlanService["Meal Plan Engine<br/>(Allergy Check & Tag Matching)"]
        AnalysisService["Video Analysis Service"]
        GeminiClient["Gemini Service<br/>(LLM Reasoning & Video Candidate Retrieval)"]
        YouTubeClient["YouTube Integration / Metadata Fetcher<br/>(Video ID, Metadata, Links & Thumbnails)"]
        Cache["Persistent Cache Layer<br/>(File / Database Store)"]
    end

    subgraph External["External Services & APIs"]
        Gemini["✨ Google Gemini AI<br/>- Retrieve relevant meal video suggestions<br/>- Recipe & ingredient extraction<br/>- Nutritional & allergen signals"]
        YouTube["▶️ YouTube Data API / Platform<br/>- Video metadata, title, channel<br/>- Watch URLs & embed links"]
    end

    %% Flow connections
    JJFit -->|"1. POST /api/meal-plan<br/>(Health Profile, BP, Restrictions, Allergies)"| API
    API --> MealPlanService
    MealPlanService --> AnalysisService

    AnalysisService <-->|"Read / Write Cache"| Cache
    AnalysisService -->|"2. Query video candidates & recipe analysis"| GeminiClient
    GeminiClient -->|"Prompt with health context"| Gemini
    Gemini -->|"Returns candidate video ideas & nutrition facts"| GeminiClient

    AnalysisService -->|"3. Resolve video links & verify metadata"| YouTubeClient
    YouTubeClient -->|"Fetch metadata & watch links"| YouTube
    YouTube -->|"Return video details & playable URLs"| YouTubeClient

    MealPlanService -->|"4. Return validated recommendations & reasons"| API
    API -->|"5. Response JSON (Ranked videos, whyItFits, allergy safety)"| JJFit
    JJFit -.->|"6. Stream / Embed video playback"| YouTube
```

---

## 2. Sequence Diagram (End-to-End User Flow)

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User
    participant App as 📱 JJFit (iOS / Android)
    participant Backend as ⚙️ MealPilot Backend
    participant Gemini as ✨ Google Gemini API
    participant YouTube as ▶️ YouTube API / Platform

    User->>App: Input health profile (e.g., BP 140/90, vegan, peanut allergy)
    App->>Backend: POST /api/meal-plan (profile, restrictions, allergies)
    
    activate Backend
    Backend->>Gemini: Query for meal videos & recipe recommendations matching profile
    activate Gemini
    Gemini-->>Backend: Suggested video concepts, recipes, ingredients, & nutritional signals
    deactivate Gemini

    Backend->>YouTube: Query metadata, channel info & playable watch/embed URLs
    activate YouTube
    YouTube-->>Backend: Video metadata, channel, title, video ID & links
    deactivate YouTube

    rect rgb(240, 248, 255)
        note over Backend: Allergy Safety & Filtering Engine<br/>1. Hard-block detected allergen matches<br/>2. Match dietary restriction tags<br/>3. Compute 'whyItFits' personalized reasoning
    end

    Backend-->>App: 200 OK (Ranked recommendations, safety verdict, disclaimer)
    deactivate Backend

    App->>User: Display curated meal plan cards & warnings
    User->>App: Tap to watch recommended meal video
    App->>YouTube: Stream video via embedded player or deep link
```

---

## 3. Core Component Breakdown

### 3.1 Frontend: **JJFit Mobile App** (iOS / Android)
* **User Health & Dietary Onboarding**: Collects health conditions (e.g., hypertension, diabetes), biometric data (e.g., blood pressure), dietary preferences, and strict allergies.
* **Meal Plan Feed**: Displays tailored meal recommendations, nutritional breakdowns, and personalized explanations (*"Why it fits"*).
* **Safety Badges**: Visual indicator of allergy safety verdicts (`safe`, `unsafe`, `needs-review`).
* **Media Player**: Native embedded player or deep-link redirect to YouTube watch URLs.

### 3.2 Backend: **MealPilot Service** (NestJS)
* **REST API Gateway**: Exposes secure endpoints (such as `POST /api/meal-plan` and `GET /api/health`).
* **Gemini Service**:
  * Leverages Gemini to discover recipe/meal video suggestions suited to complex health profiles.
  * Extracts reconstructed transcripts, ingredients, nutrition signals, and potential allergen presence.
* **YouTube Service / Util**:
  * Resolves and extracts canonical video IDs from various URL formats (`watch`, `youtu.be`, `shorts`, `embed`).
  * Enriches video candidates with author/channel details and valid playback URLs.
* **Safety & Filtering Engine**:
  * **Allergy Safeguard**: Enforces hard-blocking when ingredients or transcripts conflict with user allergies.
  * **Dietary Tag Matching**: Validates adherence to restrictions like `low-sodium`, `gluten-free`, `vegan`, or `low-carb`.
* **Caching Layer**:
  * Persists video analyses locally or in a fast key-value cache to minimize external latency and API costs.

### 3.3 External Providers
* **Google Gemini API**: Advanced LLM for nutritional reasoning, recipe deconstruction, and video-to-health alignment.
* **YouTube**: Video hosting platform providing video metadata and streaming playback endpoints.
