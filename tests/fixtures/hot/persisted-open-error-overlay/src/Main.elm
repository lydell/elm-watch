module Main exposing (main)

import Browser
import Html

main =
  Browser.sandbox
    { init = 0
    , update = \_ _ -> 0
    , view = \_ -> if True && 5 then Html.text "yes" else Html.text "no"
    }
