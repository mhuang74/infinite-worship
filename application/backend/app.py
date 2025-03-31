import os
import sys
import uuid
import json
import traceback
import numpy as np
from flask import Flask, request, jsonify
from flask_cors import CORS
from werkzeug.utils import secure_filename

# Add the remixatron directory to the path
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'exploration/remixatron'))

# Import the InfiniteJukebox class
from Remixatron import InfiniteJukebox

app = Flask(__name__)
CORS(app)

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # Increased to 32MB max upload size
app.config['TIMEOUT'] = 300  # 5 minutes timeout

# Store processed songs
processed_songs = {}

def progress_callback(pct_complete, message):
    """Callback function for InfiniteJukebox progress updates"""
    print(f"[{pct_complete}]: {message}")

@app.route('/upload', methods=['POST'])
def upload_file():
    try:
        if 'file' not in request.files:
            return jsonify({'error': 'No file part'}), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({'error': 'No selected file'}), 400
        
        if file:
            # Generate deterministic ID by hashing the file contents
            file_contents = file.read()
            # Generate deterministic ID using SHA-256 hash of file contents
            import hashlib
            song_id = hashlib.sha256(file_contents).hexdigest()
            file.seek(0)  # Reset file pointer after reading
            
            # Save the file
            # filename = secure_filename(file.filename)
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{song_id}")
            file.save(file_path)
            
            print(f"File saved to {file_path}")
            
            try:
                # Check if file exists and is readable
                if not os.path.exists(file_path):
                    return jsonify({'error': f'File not saved properly to {file_path}'}), 500
                
                # Get file size
                file_size = os.path.getsize(file_path)
                print(f"File size: {file_size} bytes")
                
                if file_size == 0:
                    return jsonify({'error': 'Uploaded file is empty'}), 400
                
                # Load cached beats if available
                beats_cache_filename = file_path + '.npy'
                cached_beats = np.array([])

                try:
                    cached_beats = np.load(beats_cache_filename)
                    print(f"Loaded beat cache from {beats_cache_filename}")
                except FileNotFoundError:
                    print(f"No beats cache file found: '{beats_cache_filename}'")
                except Exception as e:
                    print(f"Warning: Error loading beat cache '{beats_cache_filename}': {e}")

                # Process the song with InfiniteJukebox
                print(f"Starting to process file with InfiniteJukebox...")
                
                # Use a try-except block specifically for the InfiniteJukebox processing
                try:
                    jukebox = InfiniteJukebox(
                        filename=file_path,
                        progress_callback=progress_callback,
                        do_async=False,
                        starting_beat_cache=cached_beats
                    )
                    
                    # Check if beats were properly detected
                    if not hasattr(jukebox, 'beats') or len(jukebox.beats) == 0:
                        return jsonify({'error': 'No beats detected in the audio file'}), 400
                    
                    print(f"Successfully processed file. Found {len(jukebox.beats)} beats.")
                    
                    # Convert beats to a serializable format
                    segments = []
                    for beat in jukebox.beats:
                        # Remove the buffer which is not JSON serializable
                        beat_copy = beat.copy()
                        # if 'buffer' in beat_copy:
                        #     del beat_copy['buffer']
                        # if 'start_index' in beat_copy:
                        #     del beat_copy['start_index']
                        # if 'stop_index' in beat_copy:
                        #     del beat_copy['stop_index']
                        segments.append(beat_copy)
                    
                    # Store the processed data
                    processed_songs[song_id] = {
                        'segments': segments,
                        'duration': jukebox.duration,
                        'tempo': float(jukebox.tempo),
                        'sample_rate': jukebox.sample_rate
                    }
                    
                    return jsonify({
                        'song_id': song_id,
                        'segments': segments,
                        'duration': jukebox.duration,
                        'tempo': float(jukebox.tempo),
                        'sample_rate': jukebox.sample_rate
                    })
                
                except Exception as e:
                    print(f"Error in InfiniteJukebox processing: {str(e)}")
                    print(traceback.format_exc())
                    return jsonify({'error': f'Error processing audio: {str(e)}'}), 500
                
            except Exception as e:
                print(f"Error checking or processing file: {str(e)}")
                print(traceback.format_exc())
                return jsonify({'error': f'Error processing file: {str(e)}'}), 500
    
    except Exception as e:
        print(f"Unexpected error in upload_file: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500
    
    return jsonify({'error': 'Failed to process file'}), 500

@app.route('/segments/<song_id>', methods=['GET'])
def get_segments(song_id):
    if song_id not in processed_songs:
        return jsonify({'error': 'Song not found'}), 404
    
    return jsonify(processed_songs[song_id])

@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({'status': 'ok', 'message': 'Server is running'}), 200

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000) 