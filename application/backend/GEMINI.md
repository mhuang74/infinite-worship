# Project Overview

This project is a web application called "Infinite Worship" that allows users to upload songs and experience an "infinite" playback loop. The application analyzes the musical structure of a song, identifies similar-sounding beats, and can seamlessly jump between them to create a continuous listening experience.

The project is composed of two main parts:

*   **Frontend**: A [Next.js](https://nextjs.org/) and [React](https://reactjs.org/)-based single-page application that provides the user interface for uploading songs, visualizing the audio waveform, and controlling playback.
*   **Backend**: A [Flask](https://flask.palletsprojects.com/)-based Python API that handles audio processing, beat detection, and segment analysis.

## Key Technologies

### Frontend

*   **Framework**: [Next.js](https://nextjs.org/) (React)
*   **Language**: [TypeScript](https://www.typescriptlang.org/)
*   **Styling**: [Tailwind CSS](https://tailwindcss.com/)
*   **Audio Visualization**: [wavesurfer.js](https://wavesurfer.xyz/)
*   **API Communication**: [axios](https://axios-http.com/)

### Backend

*   **Framework**: [Flask](https://flask.palletsprojects.com/)
*   **Language**: [Python](https://www.python.org/)
*   **Audio Analysis**: [Librosa](https://librosa.org/doc/latest/index.html), [Madmom](https://madmom.readthedocs.io/en/latest/)
*   **Scientific Computing**: [NumPy](https://numpy.org/), [SciPy](https://scipy.org/)

## Building and Running

### Frontend

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Run in Development Mode**:
    ```bash
    npm run dev
    ```
    The application will be available at [http://localhost:3000](http://localhost:3000).

### Backend

1.  **Install Dependencies**:
    ```bash
    pip install -r requirements.txt
    ```
2.  **Run the Server**:
    ```bash
    ./start-server.sh
    ```
    The API will be available at [http://localhost:5001](http://localhost:5001).

## Development Conventions

*   The frontend and backend are developed as separate applications.
*   The frontend communicates with the backend via a RESTful API.
*   The backend uses a Python environment with dependencies managed by `pip` and `requirements.txt`.
*   The frontend uses a Node.js environment with dependencies managed by `npm` and `package.json`.
*   During frontend development, the backend is started using Docker. Don't try to start the backend again.
