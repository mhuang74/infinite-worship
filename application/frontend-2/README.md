# Infinite Worship Frontend

This is a Next.js application built to provide a user interface for the Infinite Worship audio processing backend. It allows users to upload songs, visualize their musical structure, and experience an "infinite" playback loop where the song seamlessly jumps between similar-sounding beats.

## Tech Stack

*   **Framework**: [Next.js](https://nextjs.org/)
*   **Language**: [TypeScript](https://www.typescriptlang.org/)
*   **UI Library**: [React](https://reactjs.org/)
*   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
*   **Audio Visualization**: [wavesurfer.js](https://wavesurfer.xyz/)
*   **API Communication**: [axios](https://axios-http.com/)

## Major Features & Improvements

*   **Song Upload**: A simple interface to select and upload an audio file to the backend for processing.
*   **Robust Audio Engine**: The application features a decoupled, self-contained `AudioEngine` that uses a look-ahead scheduler with the Web Audio API. This ensures perfectly smooth, gapless playback and seamless transitions, even when jumping between segments.
*   **Dynamic Jumping**: At each potential jump point, the application randomly decides whether to jump to a musically similar section of the song, creating a unique and endless listening experience.
*   **Interactive Playback Controls**:
    *   Play, Pause, Stop, and Restart functionality.
    *   A dynamic slider to control the probability of a jump occurring (from 0% to 100%).
*   **Advanced Visualization**:
    *   Displays the full audio waveform.
    *   Overlays each beat as a colored block, with the color corresponding to its musical cluster.
    *   Highlights the currently playing beat.
    *   Indicates potential jump candidates with a "glowing" animation.

## Key Libraries & Design Choices

### `wavesurfer.js` for Visualization

The rich visualization of the song's waveform is a core feature of the UI. Manually implementing this is complex, involving low-level Web Audio API analysis and HTML Canvas drawing.

`wavesurfer.js` is a specialized library that handles this complexity for us, providing a simple API to render a beautiful and performant waveform.

In this application, `wavesurfer.js` is used **exclusively for visualization**. The actual audio playback is handled by our custom `AudioEngine`. This separation is crucial for enabling the complex beat-scheduling and jumping logic. The process is as follows:

1.  **Loading**: When a song is uploaded, `wavesurfer.js` is given the audio file to render the waveform.
2.  **Synchronization**: As our internal `AudioEngine` plays each beat, it notifies the React UI of the `currentBeat`.
3.  **Updating**: A `useEffect` hook in the `Visualization` component listens for changes to `currentBeat` and calls `wavesurfer.current.seekTo()` to move the visual playhead to the correct position, keeping the waveform perfectly in sync with the audio.

## Getting Started

### Prerequisites

*   [Node.js](https://nodejs.org/) (v18 or later recommended)
*   [npm](https://www.npmjs.com/)

### Installation

1.  Navigate to the `application/frontend-2` directory.
2.  Install the required dependencies:
    ```bash
    npm install
    ```

### Running in Development Mode

1.  Make sure the backend server is running and accessible.
2.  Start the frontend development server:
    ```bash
    npm run dev
    ```
3.  Open your browser and navigate to [http://localhost:3000](http://localhost:3000).

