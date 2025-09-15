import os
import sys
import uuid
import json
import pickle
import gzip
import traceback
import base64
import numpy as np
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from werkzeug.utils import secure_filename

# Import the song mapper
import song_mapper

# Add the remixatron directory to the path
sys.path.append(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'exploration/remixatron'))

# Import the InfiniteJukebox class
from Remixatron import InfiniteJukebox

app = Flask(__name__)
CORS(app)

# Initialize the song mapper
song_db = song_mapper.get_instance()

# Configure upload folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 32 * 1024 * 1024  # Increased to 32MB max upload size
app.config['TIMEOUT'] = 300  # 5 minutes timeout

# Store processed songs
processed_songs = {}

def decode_filename(encoded_filename):
    """Decode a base64 encoded filename back to its original form with Chinese characters"""
    try:
        # Extract the encoded part (before the hash)
        encoded_part = encoded_filename.split('_')[0]
        original = base64.urlsafe_b64decode(encoded_part.encode('ascii')).decode('utf-8')
        return original
    except Exception as e:
        print(f"Error decoding filename: {str(e)}")
        return encoded_filename

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

            # Preserve original filename by encoding it to base64 instead of using secure_filename
            # This ensures Chinese characters are preserved
            original_filename = file.filename
            encoded_filename = base64.urlsafe_b64encode(original_filename.encode('utf-8')).decode('ascii')
                        
            try:
                # Generate deterministic ID by hashing the file contents
                file_contents = file.read()
                # Generate deterministic ID using SHA-256 hash of file contents
                import hashlib
                song_id = encoded_filename + '_' + hashlib.sha256(file_contents).hexdigest()
                file.seek(0)  # Reset file pointer after reading
                
                # Save the file
                # filename = secure_filename(file.filename)
                file_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{song_id}")
                file.save(file_path)
                
                print(f"Song {original_filename} saved to {file_path}")

                # Check if file exists and is readable
                if not os.path.exists(file_path):
                    return jsonify({'error': f'Song {file.filename} not saved properly to {file_path}'}), 500
                
                # Get file size
                file_size = os.path.getsize(file_path)
                print(f"File size: {file_size} bytes")
                
                if file_size == 0:
                    return jsonify({'error': f'Uploaded song {original_filename} is empty'}), 400
                
            except Exception as e:
                print(f"Error checking file: {str(e)}")
                print(traceback.format_exc())
                return jsonify({'error': f'Error reading or relocating song {original_filename}: {str(e)}'}), 500
            
            # Load cached beats if available
            beats_cache_filename = file_path + '_beats.npy'
            cached_beats = np.array([])
        
            try:
                cached_beats = np.load(beats_cache_filename)
                print(f"Loaded beat cache from {beats_cache_filename}")
            except FileNotFoundError:
                print(f"No beats cache file found: '{beats_cache_filename}'")
            except Exception as e:
                print(f"Warning: Error loading beat cache '{beats_cache_filename}': {e}")


            
            # try to load pickled jukebox
            jukebox_pickled_filename = file_path + '_jukebox.pkl'
            jukebox = None

            try:
                with gzip.open(jukebox_pickled_filename + '.gz', 'rb') as f:
                    jukebox = pickle.load(f)
                print(f"Loaded compressed pickled jukebox for song {original_filename} from {jukebox_pickled_filename}.gz")
            except FileNotFoundError:
                print(f"No compressed pickled jukebox file found: '{jukebox_pickled_filename}.gz'")
            except Exception as e:
                print(f"Warning: Error loading compressed pickled jukebox '{jukebox_pickled_filename}.gz': {e}")

            if jukebox is None:
                # Process song with InfiniteJukebox
                try:
                    print(f"Starting to process file with InfiniteJukebox...")

                    jukebox = InfiniteJukebox(
                        filename=file_path,
                        progress_callback=progress_callback,
                        do_async=False,
                        starting_beat_cache=cached_beats
                    )
                    
                    # Check if beats were properly detected
                    if not hasattr(jukebox, 'beats') or len(jukebox.beats) == 0:
                        return jsonify({'error': 'No beats detected in the audio file'}), 400
                    
                    # Save the jukebox object as a pickled file for future use
                    try:
                        with gzip.open(jukebox_pickled_filename + '.gz', 'wb') as f:
                            pickle.dump(jukebox, f, protocol=pickle.HIGHEST_PROTOCOL)
                        print(f"Successfully saved compressed pickled jukebox to {jukebox_pickled_filename}.gz")
                    except Exception as e:
                        print(f"Warning: Error saving compressed pickled jukebox '{jukebox_pickled_filename}.gz': {e}")
                    
                    print(f"Successfully processed song {original_filename}. Found {len(jukebox.beats)} beats.")

                except Exception as e:
                    print(f"Error in InfiniteJukebox processing: {str(e)}")
                    print(traceback.format_exc())
                    return jsonify({'error': f'Error processing audio: {str(e)}'}), 500


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
                'filename': original_filename,
                'segments': segments,
                'duration': jukebox.duration,
                'tempo': float(jukebox.tempo),
                'sample_rate': jukebox.sample_rate
            }
            
            # Store song information in the database
            # Calculate the number of clusters
            clusters_count = None
            if hasattr(jukebox, 'clusters'):
                if isinstance(jukebox.clusters, (list, tuple, set)):
                    clusters_count = len(jukebox.clusters)
                elif isinstance(jukebox.clusters, int):
                    # If clusters is already an integer count, use it directly
                    clusters_count = jukebox.clusters
            
            # Calculate total jump points by counting beats that have jump_candidates
            jump_points_count = 0
            for beat in jukebox.beats:
                # Check if the beat has jump_candidates and it's not empty
                if (isinstance(beat, dict) and
                    'jump_candidates' in beat and
                    beat['jump_candidates'] and
                    len(beat['jump_candidates']) > 0):
                    jump_points_count += 1
            
            song_db.add_song(
                song_id=song_id,
                original_filename=original_filename,
                encoded_filename=encoded_filename,
                file_path=file_path,
                duration=jukebox.duration,
                tempo=float(jukebox.tempo),
                beats=len(jukebox.beats),
                clusters=clusters_count,
                jump_points=jump_points_count,
                sample_rate=jukebox.sample_rate
            )
            
            return jsonify({
                'filename': original_filename,
                'song_id': song_id,
                'segments': segments,
                'duration': jukebox.duration,
                'tempo': float(jukebox.tempo),
                'sample_rate': jukebox.sample_rate
            })

    except Exception as e:
        print(f"Unexpected error in upload_file: {str(e)}")
        print(traceback.format_exc())
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500
    
    return jsonify({'error': 'Failed to process file'}), 500

@app.route('/segments/<song_id>', methods=['GET'])
def get_segments(song_id):
    # First check if the song is in memory
    if song_id in processed_songs:
        return jsonify(processed_songs[song_id])
    
    # If not in memory, try to load from database
    song = song_db.get_song(song_id)
    if song is None:
        return jsonify({'error': 'Song not found in database'}), 404
    
    # Get the file path from the database
    file_path = song['file_path']
    original_filename = song['original_filename']
    
    # Try to load the pickled jukebox file
    jukebox_pickled_filename = file_path + '_jukebox.pkl'
    jukebox = None
    
    try:
        with gzip.open(jukebox_pickled_filename + '.gz', 'rb') as f:
            jukebox = pickle.load(f)
        print(f"Loaded compressed pickled jukebox for song {original_filename} from {jukebox_pickled_filename}.gz")
    except FileNotFoundError:
        print(f"No compressed pickled jukebox file found: '{jukebox_pickled_filename}.gz'")
        return jsonify({'error': 'Song data not found'}), 404
    except Exception as e:
        print(f"Error loading compressed pickled jukebox '{jukebox_pickled_filename}.gz': {e}")
        return jsonify({'error': f'Error loading song data: {str(e)}'}), 500
    
    if jukebox is None:
        return jsonify({'error': 'Failed to load song data'}), 500
    
    # Convert beats to a serializable format
    segments = []
    for beat in jukebox.beats:
        beat_copy = beat.copy()
        segments.append(beat_copy)
    
    # Store the processed data in memory for future requests
    processed_songs[song_id] = {
        'filename': original_filename,
        'segments': segments,
        'duration': jukebox.duration,
        'tempo': float(jukebox.tempo),
        'sample_rate': jukebox.sample_rate
    }
    
    return jsonify(processed_songs[song_id])

@app.route('/uploads/<song_id>', methods=['GET'])
def get_upload(song_id):
    """Serve the uploaded audio file for a given song_id"""
    # Get the song from the database
    song = song_db.get_song(song_id)
    if song is None:
        return jsonify({'error': 'Song not found in database'}), 404
    
    # Get the file path from the database
    file_path = song['file_path']
    
    # Check if the file exists
    if not os.path.exists(file_path):
        return jsonify({'error': 'Audio file not found on server'}), 404
    
    # Determine the file type (you might want to store this in the database)
    file_type = 'audio/mpeg'  # Default to MP3
    if file_path.lower().endswith('.wav'):
        file_type = 'audio/wav'
    elif file_path.lower().endswith('.ogg'):
        file_type = 'audio/ogg'
    elif file_path.lower().endswith('.flac'):
        file_type = 'audio/flac'
    
    # Return the file
    return send_file(file_path, mimetype=file_type)

@app.route('/health', methods=['GET'])
def health_check():
    """Simple health check endpoint"""
    return jsonify({'status': 'ok', 'message': 'Server is running'}), 200

@app.route('/filename_test/<encoded_filename>', methods=['GET'])
def test_filename_decoding(encoded_filename):
    """Test endpoint to verify filename encoding/decoding works correctly"""
    original = decode_filename(encoded_filename)
    return jsonify({
        'encoded': encoded_filename,
        'decoded': original
    }), 200

@app.route('/songs', methods=['GET'])
def get_songs():
    """Get all songs from the database"""
    songs = song_db.get_all_songs()
    return jsonify({
        'songs': songs
    })

@app.route('/songs/<song_id>', methods=['GET'])
def get_song(song_id):
    """Get a specific song from the database"""
    song = song_db.get_song(song_id)
    if song is None:
        return jsonify({'error': 'Song not found'}), 404
    return jsonify(song)

@app.route('/songs/search', methods=['GET'])
def search_songs():
    """Search for songs in the database"""
    query = request.args.get('q', '')
    songs = song_db.search_songs(query)
    return jsonify({
        'songs': songs,
        'query': query
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)