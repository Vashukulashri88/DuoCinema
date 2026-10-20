import os
import sys
import tkinter as tk
from tkinter import filedialog

def pick_file():
    try:
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        path = filedialog.askopenfilename(
            title="Select Movie / Video to Watch Together",
            filetypes=[
                ("Supported Video Files", "*.mp4;*.webm;*.mkv;*.mov;*.m4v;*.avi"),
                ("MP4 Videos (*.mp4)", "*.mp4"),
                ("MKV Videos (*.mkv)", "*.mkv"),
                ("WebM Videos (*.webm)", "*.webm"),
                ("All Files (*.*)", "*.*")
            ]
        )
        root.destroy()
        if path and os.path.exists(path):
            print(path)
    except Exception:
        pass

if __name__ == "__main__":
    pick_file()
