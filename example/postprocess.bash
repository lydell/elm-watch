# This example actually uses `./postprocess.js` – not this file.
# But in case you’d like to use a bash script, here’s an example.
# It’s not as advanced as the JS version, but it’s a start.
# Edit "postprocess" in `./elm-watch.json` to try it out:
#
#     "postprocess": ["bash", "postprocess.bash"],

target_name="$1"
compilation_mode="$2"
run_mode="$3"

patch() {
  # Silly example of patching the output, which just changes all occurrences of
  # the string '+' to 'plus' and '-' to 'minus'. (Most Elm example apps in here
  # are the famous “Counter example” which has plus and minus buttons.)
  sed "s/'+'/'plus'/g" | sed "s/'-'/'minus'/g"
}

case "$compilation_mode" in
  debug|standard)
    patch
    ;;

  optimize)
    # Also minify with esbuild in --optimize mode.
    patch | ./node_modules/.bin/esbuild --minify
    ;;

  *)
    echo "Unknown compilation mode: $compilation_mode"
    exit 1
    ;;
esac
