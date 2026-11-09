module Main exposing (main)

import A
import B
import Html


main =
    Html.text (A.a ++ A.b ++ B.c)
