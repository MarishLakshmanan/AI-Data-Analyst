"""Generate an RSA key pair for Snowflake key-pair authentication.

Usage:
    uv run python -m scripts.generate_snowflake_key [--out-dir .] [--name rsa_key]
                                                    [--passphrase] [--force]

Writes <name>.p8 (PKCS#8 private key, mode 0600) and <name>.pub, then prints the
ALTER USER statement that registers the public key in Snowflake. Set
SNOWFLAKE_PRIVATE_KEY_PATH to the .p8 file (and SNOWFLAKE_PRIVATE_KEY_PASSPHRASE
if you used --passphrase). Never commit the private key; .gitignore covers rsa_key*.
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out-dir", default=".", help="directory for the key files (default: .)")
    ap.add_argument("--name", default="rsa_key", help="file name stem (default: rsa_key)")
    ap.add_argument("--passphrase", action="store_true", help="encrypt the private key (prompts for a passphrase)")
    ap.add_argument("--force", action="store_true", help="overwrite existing key files")
    args = ap.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    priv_path, pub_path = out / f"{args.name}.p8", out / f"{args.name}.pub"

    existing = [p for p in (priv_path, pub_path) if p.exists()]
    if existing and not args.force:
        print(f"Refusing to overwrite: {', '.join(map(str, existing))} (use --force)", file=sys.stderr)
        return 1

    encryption: serialization.KeySerializationEncryption = serialization.NoEncryption()
    if args.passphrase:
        pw = getpass.getpass("Passphrase: ")
        if not pw or pw != getpass.getpass("Confirm passphrase: "):
            print("Passphrases are empty or do not match.", file=sys.stderr)
            return 1
        encryption = serialization.BestAvailableEncryption(pw.encode())

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, encryption
    )
    public_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )

    # Create the private key with 0600 from the start (no world-readable window)
    fd = os.open(priv_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(private_pem)
    os.chmod(priv_path, 0o600)
    pub_path.write_bytes(public_pem)

    body = "".join(public_pem.decode().strip().splitlines()[1:-1])  # strip PEM header/footer
    print(f"Private key: {priv_path}\nPublic key:  {pub_path}\n")
    print("Run this in Snowflake (as a user that can alter the account user):\n")
    print(f"  ALTER USER <SNOWFLAKE_USER> SET RSA_PUBLIC_KEY='{body}';\n")
    print(f"Then set SNOWFLAKE_PRIVATE_KEY_PATH={priv_path}"
          + (" and SNOWFLAKE_PRIVATE_KEY_PASSPHRASE" if args.passphrase else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
