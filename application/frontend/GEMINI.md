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


## Development Conventions

*   The frontend and backend are developed as separate applications.
*   The frontend communicates with the backend via a RESTful API.
*   The backend uses a Python environment with dependencies managed by `pip` and `requirements.txt`.
*   The frontend uses a Node.js environment with dependencies managed by `npm` and `package.json`.

## Coding Style and Conventions

*   **Python**: All Python code must adhere to the `pip` package manager and linting rules.
*   **JavaScript/TypeScript**: All frontend code must pass linting checks with the configured ESLint rules.
*   **Naming Conventions**: Use `camelCase` for JavaScript variables and functions. Use `snake_case` for Python variables and functions.

## Development Workflow

*   **Running the Project**: Both frontend and backend are started elsewhere. DO NOT RESTART them during coding changes.
*   **API Design**: When creating new API endpoints, follow RESTful principles.
*   **Planning**: Always break down tasks and create a plan for review. Do not start implementation until your plan has been reviewed.