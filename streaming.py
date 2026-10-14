import os
import mimetypes
from typing import AsyncGenerator, Tuple
from fastapi import Request, HTTPException, status
from fastapi.responses import StreamingResponse
import aiofiles

# 512 KB buffer for disk read blocks
READ_BLOCK_SIZE = 512 * 1024

# 8 MB maximum window served per open-ended range request
# This prevents 15GB-16GB files from blocking a single TCP connection
# and allows instant sub-second seeking anywhere in massive files!
MAX_CHUNK_SERVED = 8 * 1024 * 1024

def get_file_mime(filepath: str) -> str:
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".mp4" or ext == ".m4v":
        return "video/mp4"
    elif ext == ".webm":
        return "video/webm"
    elif ext == ".mkv":
        # Many Chromium browsers & Android devices can parse MKV directly
        # when sent as video/mp4, video/webm or video/x-matroska
        return "video/x-matroska"
    elif ext == ".mov":
        return "video/quicktime"
    
    mime, _ = mimetypes.guess_type(filepath)
    return mime or "video/mp4"

def parse_range_header(range_header: str, file_size: int) -> Tuple[int, int]:
    """
    Parses Range: bytes=start-end header.
    Returns (start, end) inclusive with smart chunk capping for 15GB+ files.
    """
    try:
        prefix, value = range_header.strip().split("=")
        if prefix.lower() != "bytes":
            return 0, min(MAX_CHUNK_SERVED - 1, file_size - 1)

        parts = value.split("-")
        if len(parts) != 2:
            return 0, min(MAX_CHUNK_SERVED - 1, file_size - 1)

        start_str, end_str = parts[0].strip(), parts[1].strip()

        if start_str and end_str:
            start = int(start_str)
            end = int(end_str)
        elif start_str:
            start = int(start_str)
            # Smart Chunk Capping: Don't stream all 16GB in one response!
            # Stream up to 8MB per range slice so the browser buffers progressively
            end = min(start + MAX_CHUNK_SERVED - 1, file_size - 1)
        elif end_str:
            suffix_len = int(end_str)
            start = max(0, file_size - suffix_len)
            end = file_size - 1
        else:
            return 0, min(MAX_CHUNK_SERVED - 1, file_size - 1)

        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        return start, end
    except Exception:
        return 0, min(MAX_CHUNK_SERVED - 1, file_size - 1)

async def async_file_chunk_generator(filepath: str, start: int, end: int, block_size: int = READ_BLOCK_SIZE) -> AsyncGenerator[bytes, None]:
    """
    Asynchronously reads byte slices from disk using aiofiles.
    Non-blocking for FastAPI event loop, ultra-fast for multi-gigabyte video files.
    """
    async with aiofiles.open(filepath, mode="rb") as f:
        await f.seek(start)
        bytes_remaining = end - start + 1
        while bytes_remaining > 0:
            read_len = min(block_size, bytes_remaining)
            data = await f.read(read_len)
            if not data:
                break
            bytes_remaining -= len(data)
            yield data

def range_stream_response(request: Request, filepath: str) -> StreamingResponse:
    if not os.path.exists(filepath):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Video file not found")

    stat_result = os.stat(filepath)
    file_size = stat_result.st_size
    mtime = int(stat_result.st_mtime)
    etag = f'"{file_size}-{mtime}"'
    
    range_header = request.headers.get("range")
    content_type = get_file_mime(filepath)

    if range_header:
        start, end = parse_range_header(range_header, file_size)
        content_length = end - start + 1

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": content_type,
            "ETag": etag,
            # Cache segments so rewinds & repeated seeks don't re-download from disk
            "Cache-Control": "public, max-age=86400, immutable",
            "X-Content-Type-Options": "nosniff"
        }

        return StreamingResponse(
            async_file_chunk_generator(filepath, start, end),
            status_code=status.HTTP_206_PARTIAL_CONTENT,
            headers=headers,
            media_type=content_type,
        )
    else:
        # If no range requested (e.g. metadata probe), serve initial chunk or full header
        initial_chunk_size = min(MAX_CHUNK_SERVED, file_size)
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(file_size),
            "Content-Type": content_type,
            "ETag": etag,
            "Cache-Control": "public, max-age=86400",
        }
        return StreamingResponse(
            async_file_chunk_generator(filepath, 0, file_size - 1),
            status_code=status.HTTP_200_OK,
            headers=headers,
            media_type=content_type,
        )
