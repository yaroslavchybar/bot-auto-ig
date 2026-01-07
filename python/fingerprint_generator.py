#!/usr/bin/env python3
"""
Fingerprint Generator using BrowserForge.
Generates a complete browser fingerprint for Camoufox injection.
"""
import sys
import json
import argparse
from browserforge.fingerprints import FingerprintGenerator, Screen


def generate_fingerprint(os_name: str = "windows") -> dict:
    """Generate a Firefox fingerprint for the specified OS."""
    # Map common OS names to browserforge format
    os_map = {
        "windows": "windows",
        "macos": "macos", 
        "mac": "macos",
        "linux": "linux",
    }
    target_os = os_map.get(os_name.lower(), "windows")
    
    # Create generator with reasonable screen constraints
    screen = Screen(
        min_width=1280,
        max_width=1920,
        min_height=720,
        max_height=1080,
    )
    
    generator = FingerprintGenerator(
        screen=screen,
        mock_webrtc=True,  # Privacy: mock WebRTC to prevent IP leaks
    )
    
    # Generate fingerprint for Firefox only (Camoufox is Firefox-based)
    fingerprint = generator.generate(
        browser="firefox",
        os=target_os,
    )
    
    # Convert to serializable dict
    return fingerprint_to_dict(fingerprint)


def fingerprint_to_dict(fp) -> dict:
    """Convert a Fingerprint object to a JSON-serializable dictionary."""
    result = {}
    
    # Screen
    if hasattr(fp, 'screen') and fp.screen:
        screen = fp.screen
        result['screen'] = {
            'width': getattr(screen, 'width', 1920),
            'height': getattr(screen, 'height', 1080),
            'availWidth': getattr(screen, 'availWidth', 1920),
            'availHeight': getattr(screen, 'availHeight', 1040),
            'colorDepth': getattr(screen, 'colorDepth', 24),
            'pixelDepth': getattr(screen, 'pixelDepth', 24),
            'devicePixelRatio': getattr(screen, 'devicePixelRatio', 1),
        }
    
    # Navigator
    if hasattr(fp, 'navigator') and fp.navigator:
        nav = fp.navigator
        result['navigator'] = {
            'userAgent': getattr(nav, 'userAgent', ''),
            'platform': getattr(nav, 'platform', ''),
            'language': getattr(nav, 'language', 'en-US'),
            'languages': getattr(nav, 'languages', ['en-US']),
            'hardwareConcurrency': getattr(nav, 'hardwareConcurrency', 4),
            'deviceMemory': getattr(nav, 'deviceMemory', 8),
            'maxTouchPoints': getattr(nav, 'maxTouchPoints', 0),
        }
    
    # WebGL / Video Card
    if hasattr(fp, 'videoCard') and fp.videoCard:
        vc = fp.videoCard
        result['videoCard'] = {
            'vendor': getattr(vc, 'vendor', ''),
            'renderer': getattr(vc, 'renderer', ''),
        }
    
    # Headers
    if hasattr(fp, 'headers') and fp.headers:
        result['headers'] = dict(fp.headers) if hasattr(fp.headers, 'items') else fp.headers
    
    # Codecs
    if hasattr(fp, 'videoCodecs') and fp.videoCodecs:
        result['videoCodecs'] = dict(fp.videoCodecs) if hasattr(fp.videoCodecs, 'items') else fp.videoCodecs
    
    if hasattr(fp, 'audioCodecs') and fp.audioCodecs:
        result['audioCodecs'] = dict(fp.audioCodecs) if hasattr(fp.audioCodecs, 'items') else fp.audioCodecs
    
    # Fonts
    if hasattr(fp, 'fonts') and fp.fonts:
        result['fonts'] = list(fp.fonts) if hasattr(fp.fonts, '__iter__') else []
    
    # Mock WebRTC flag
    result['mockWebRTC'] = getattr(fp, 'mockWebRTC', True)
    result['slim'] = getattr(fp, 'slim', False)
    
    return result


def main():
    parser = argparse.ArgumentParser(description='Generate browser fingerprint')
    parser.add_argument('--os', type=str, default='windows',
                       choices=['windows', 'macos', 'linux'],
                       help='Target operating system')
    args = parser.parse_args()
    
    try:
        fingerprint = generate_fingerprint(args.os)
        print(json.dumps(fingerprint, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e)}), file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
