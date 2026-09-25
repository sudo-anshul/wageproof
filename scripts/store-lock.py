"""Hold a local POSIX advisory lock for the lifetime of the parent pipe."""
import fcntl
import pathlib
import sys

lock_path = pathlib.Path(sys.argv[1]) / '.server.lock'
with lock_path.open('a+') as handle:
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('IN_USE', flush=True)
        raise SystemExit(73)
    print('LOCKED', flush=True)
    sys.stdin.buffer.read()
