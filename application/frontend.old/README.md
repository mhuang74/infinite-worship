# Infinite Worship Frontend

A modern web interface for the Infinite Worship project, allowing users to upload songs, visualize song segments, control playback, and see intelligent remixing in action.

## Features

- **Song Upload**: Drag and drop or click to upload audio files
- **Audio Playback**: Play, pause, and control volume with a waveform visualization
- **Segment Visualization**: See song segments color-coded by cluster
- **Playback Progress**: Track current segment, next jump, and beats until jump
- **Song Information**: View duration, tempo, and other song metadata

## Technologies Used

- **Next.js**: React framework with App Router
- **TypeScript**: For type safety
- **Tailwind CSS**: For styling
- **WaveSurfer.js**: For audio waveform visualization
- **Axios**: For API communication

## Getting Started

### Prerequisites

- Node.js 18.17 or later
- npm or yarn

### Installation

1. Clone the repository
2. Navigate to the frontend directory:
   ```
   cd code/frontend
   ```
3. Install dependencies:
   ```
   npm install
   # or
   yarn install
   ```

### Development

Run the development server:

```bash
npm run dev
# or
yarn dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

### Building for Production

```bash
npm run build
# or
yarn build
```

## Project Structure

- `src/app`: Main application pages
- `src/components`: Reusable UI components
- `src/services`: API and data services
- `src/types`: TypeScript type definitions

## Backend Integration

The frontend is designed to work with a Python backend that processes audio files and identifies segments. For development purposes, the frontend includes a mock data generator to simulate backend responses.

## License

This project is licensed under the Apache License 2.0 - see the LICENSE file for details.
