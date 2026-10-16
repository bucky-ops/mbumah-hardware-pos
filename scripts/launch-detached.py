#!/usr/bin/env python3
"""Detached server launcher for the mbumah worktree/sandbox QA servers.

Double-fork + setsid + exec, stdio to /dev/null or a log file, so the child
survives the parent shell session entirely (init-adopted).

Usage: python3 scripts/launch-detached.py <logfile> <cwd> <cmd> [args...]
"""
import os
import sys


def main() -> None:
    if len(sys.argv) < 4:
        print("usage: launch-detached.py <logfile> <cwd> <cmd> [args...]", file=sys.stderr)
        sys.exit(2)
    logfile, cwd, cmd = sys.argv[1], sys.argv[2], sys.argv[3:]
    log_fd = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)

    pid = os.fork()
    if pid > 0:
        os.waitpid(pid, 0)  # reap the intermediate fork
        print(f"detached: {cmd} (log: {logfile})")
        return

    # First child: new session, second fork so the session leader exits.
    os.setsid()
    pid2 = os.fork()
    if pid2 > 0:
        os._exit(0)

    os.chdir(cwd)
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    os.close(log_fd)
    env = dict(os.environ)
    env.setdefault("NODE_ENV", "production")
    os.execvpe(cmd[0], cmd, env)


if __name__ == "__main__":
    main()
