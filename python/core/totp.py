import pyotp

def generate_totp_code(secret):
    """
    Generates a TOTP code from a secret key.
    
    Args:
        secret (str): The Base32 secret key.
        
    Returns:
        str: The generated TOTP code.
    Raises:
        ValueError: If the secret is invalid.
    """
    if not secret:
        raise ValueError("Введите секретный ключ Base32!")
        
    secret = secret.strip().replace(" ", "").upper()
    if not secret:
        raise ValueError("Введите секретный ключ Base32!")
    
    try:
        totp = pyotp.TOTP(secret)
        return totp.now()
    except Exception as e:
        raise ValueError(f"Неверный формат ключа: {e}")
