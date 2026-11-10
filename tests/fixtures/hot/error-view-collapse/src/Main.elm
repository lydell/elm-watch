module Main exposing (main)

import Html


type T
    = C1
    | C2
    | C3
    | C4
    | C5
    | C6
    | C7
    | C8


f : T -> String
f t =
    String.length <|
        case t of
            C1 ->
                "1"

            C2 ->
                "2"

            C3 ->
                "3"

            C4 ->
                "4"

            C5 ->
                "5"

            C6 ->
                "6"

            C7 ->
                "7"

            C8 ->
                "8"


main =
    Html.text (f C1 ++ 1)
