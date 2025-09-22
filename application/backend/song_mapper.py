import os
import sqlite3
import base64
import json
import time
from datetime import datetime

class SongMapper:
    """
    SongMapper class for managing song metadata in a SQLite database.
    This class provides functionality to:
    - Initialize and manage the SQLite database
    - Add songs to the database
    - Retrieve songs from the database
    - Decode base64 encoded filenames
    """
    
    def __init__(self, db_path=None):
        """
        Initialize the SongMapper with a database path.

        Args:
            db_path (str, optional): Path to the SQLite database file.
                If None, a default path will be used.
        """
        if db_path is None:
            # Use a default path in the uploads directory
            current_dir = os.path.dirname(os.path.abspath(__file__))
            uploads_dir = os.path.join(current_dir, 'uploads')
            os.makedirs(uploads_dir, exist_ok=True)
            db_path = os.path.join(uploads_dir, 'songs.db')

        self.db_path = db_path
        self._init_db()
    
    def _init_db(self):
        """Initialize the SQLite database with the required schema."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Create songs table if it doesn't exist
        cursor.execute('''
        CREATE TABLE IF NOT EXISTS songs (
            song_id TEXT PRIMARY KEY,
            original_filename TEXT NOT NULL,
            encoded_filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            duration REAL,
            tempo REAL,
            beats INTEGER,
            clusters INTEGER,
            jump_points INTEGER,
            sample_rate INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        ''')
        
        conn.commit()
        conn.close()
    
    def add_song(self, song_id, original_filename, encoded_filename, file_path, 
                 duration=None, tempo=None, beats=None, clusters=None, 
                 jump_points=None, sample_rate=None):
        """
        Add a song to the database.
        
        Args:
            song_id (str): Unique identifier for the song
            original_filename (str): Original filename of the song
            encoded_filename (str): Base64 encoded filename
            file_path (str): Path to the song file
            duration (float, optional): Duration of the song in seconds
            tempo (float, optional): Tempo of the song in BPM
            beats (int, optional): Number of beats in the song
            clusters (int, optional): Number of clusters in the song
            jump_points (int, optional): Number of jump points in the song
            sample_rate (int, optional): Sample rate of the song
            
        Returns:
            bool: True if the song was added successfully, False otherwise
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
            INSERT OR REPLACE INTO songs 
            (song_id, original_filename, encoded_filename, file_path, 
             duration, tempo, beats, clusters, jump_points, sample_rate)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                song_id, 
                original_filename, 
                encoded_filename, 
                file_path, 
                duration, 
                tempo, 
                beats, 
                clusters, 
                jump_points,
                sample_rate
            ))
            
            conn.commit()
            conn.close()
            print(f"Successfully saved Song `{original_filename}` with SongID `{song_id}` to database")
            return True
        except Exception as e:
            print(f"Error adding song to database: {str(e)}")
            return False
    
    def get_song(self, song_id):
        """
        Get a song from the database by its ID.
        
        Args:
            song_id (str): Unique identifier for the song
            
        Returns:
            dict: Song data or None if not found
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row  # This enables column access by name
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM songs WHERE song_id = ?', (song_id,))
            row = cursor.fetchone()
            
            conn.close()
            
            if row:
                return dict(row)
            return None
        except Exception as e:
            print(f"Error getting song from database: {str(e)}")
            return None
    
    def get_all_songs(self):
        """
        Get all songs from the database.
        
        Returns:
            list: List of song dictionaries
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            cursor.execute('SELECT * FROM songs ORDER BY original_filename')
            rows = cursor.fetchall()
            
            conn.close()
            
            return [dict(row) for row in rows]
        except Exception as e:
            print(f"Error getting all songs from database: {str(e)}")
            return []
    
    def search_songs(self, query):
        """
        Search for songs in the database.
        
        Args:
            query (str): Search query
            
        Returns:
            list: List of matching song dictionaries
        """
        try:
            conn = sqlite3.connect(self.db_path)
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            
            # Search in original_filename
            cursor.execute(
                'SELECT * FROM songs WHERE original_filename LIKE ? ORDER BY original_filename',
                (f'%{query}%',)
            )
            rows = cursor.fetchall()
            
            conn.close()
            
            return [dict(row) for row in rows]
        except Exception as e:
            print(f"Error searching songs in database: {str(e)}")
            return []
    
    def delete_song(self, song_id):
        """
        Delete a song from the database.
        
        Args:
            song_id (str): Unique identifier for the song
            
        Returns:
            bool: True if the song was deleted successfully, False otherwise
        """
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('DELETE FROM songs WHERE song_id = ?', (song_id,))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error deleting song from database: {str(e)}")
            return False
    
    @staticmethod
    def decode_filename(encoded_filename):
        """
        Decode a base64 encoded filename back to its original form.
        
        Args:
            encoded_filename (str): Base64 encoded filename
            
        Returns:
            str: Decoded original filename
        """
        try:
            # Extract the encoded part (before the hash)
            encoded_part = encoded_filename.split('_')[0]
            original = base64.urlsafe_b64decode(encoded_part.encode('ascii')).decode('utf-8')
            return original
        except Exception as e:
            print(f"Error decoding filename: {str(e)}")
            return encoded_filename
    
    @staticmethod
    def encode_filename(original_filename):
        """
        Encode a filename using base64.
        
        Args:
            original_filename (str): Original filename
            
        Returns:
            str: Base64 encoded filename
        """
        try:
            encoded = base64.urlsafe_b64encode(original_filename.encode('utf-8')).decode('ascii')
            return encoded
        except Exception as e:
            print(f"Error encoding filename: {str(e)}")
            return original_filename


# Singleton instance for easy import
_instance = None

def get_instance(db_path=None):
    """
    Get the singleton instance of SongMapper.
    
    Args:
        db_path (str, optional): Path to the SQLite database file.
            If None, a default path will be used.
            
    Returns:
        SongMapper: Singleton instance of SongMapper
    """
    global _instance
    if _instance is None:
        _instance = SongMapper(db_path)
    return _instance
