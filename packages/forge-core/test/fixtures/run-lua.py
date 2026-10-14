"""Run a Lua file with the system liblua5.4 and print its string result.

Test-only: executes generated Forge helpers against mock objects. It never
contacts EmptyEpsilon, and a clean run here is NOT evidence about the engine.
Usage: run-lua.py <file.lua>; exit 2 when liblua5.4 is not installed.
"""
import ctypes
import ctypes.util
import sys
from pathlib import Path

name = ctypes.util.find_library("lua5.4")
if name is None:
    sys.exit(2)
lib = ctypes.CDLL(name)
lib.luaL_newstate.restype = ctypes.c_void_p
lib.luaL_openlibs.argtypes = [ctypes.c_void_p]
lib.luaL_loadstring.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
lib.lua_pcallk.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_longlong, ctypes.c_void_p]
lib.lua_tolstring.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p]
lib.lua_tolstring.restype = ctypes.c_char_p
lib.lua_close.argtypes = [ctypes.c_void_p]
state = lib.luaL_newstate()
try:
    lib.luaL_openlibs(state)
    code = lib.luaL_loadstring(state, Path(sys.argv[1]).read_bytes())
    if not code:
        code = lib.lua_pcallk(state, 0, 1, 0, 0, None)
    text = lib.lua_tolstring(state, -1, None)
    result = text.decode() if text is not None else ""
    if code:
        print(result, file=sys.stderr)
        sys.exit(1)
    print(result)
finally:
    lib.lua_close(state)
