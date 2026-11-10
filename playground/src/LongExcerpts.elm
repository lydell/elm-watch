module LongExcerpts exposing (..)

{-| Code for seeing how elm-watch collapses long code excerpts in Elm errors.

This module compiles as committed. Make a temporary change at one of the
“BREAK:” comments below to get an error with a long code excerpt, and see how
it is collapsed in the terminal and in the browser (space toggles).

Break one spot at a time: Elm only reports missing patterns if there are no
type errors in the module, and a syntax error hides all other errors.

-}


type Color
    = Red
    | Orange
    | Yellow
    | Green
    | Blue
    | Indigo
    | Violet
    | Black
    | White
    | Gray


type alias Settings =
    { width : Int
    , height : Int
    , depth : Int
    , margin : Int
    , padding : Int
    , border : Int
    , radius : Int
    , opacity : Int
    , zIndex : Int
    , rotation : Int
    , scale : Int
    , blur : Int
    , shadow : Int
    , gap : Int
    }


{-| BREAK: Remove a branch (such as `Gray`).

MISSING PATTERNS, with the whole `case` marked: You should see the start and
the end of it.

BREAK: Change `"violet"` to `7`.

Only the broken branch is shown (with `^`), so nothing is collapsed.

-}
colorName : Color -> String
colorName color =
    case color of
        Red ->
            "red"

        Orange ->
            "orange"

        Yellow ->
            "yellow"

        Green ->
            "green"

        Blue ->
            "blue"

        Indigo ->
            "indigo"

        Violet ->
            "violet"

        Black ->
            "black"

        White ->
            "white"

        Gray ->
            "gray"


{-| BREAK: Change the type annotation to `Color -> String`.

The whole body is marked, starting with `String.length <|`.

-}
colorNameLength : Color -> Int
colorNameLength color =
    String.length <|
        case color of
            Red ->
                "red"

            Orange ->
                "orange"

            Yellow ->
                "yellow"

            Green ->
                "green"

            Blue ->
                "blue"

            Indigo ->
                "indigo"

            Violet ->
                "violet"

            Black ->
                "black"

            White ->
                "white"

            Gray ->
                "gray"


{-| BREAK: Add a `=` after `"white" ->` (syntax error).

The `^` is on the last line, so you should see the start of the `case` and the
lines above the error.

-}
parseColor : String -> Maybe Color
parseColor string =
    case string of
        "red" ->
            Just Red

        "orange" ->
            Just Orange

        "yellow" ->
            Just Yellow

        "green" ->
            Just Green

        "blue" ->
            Just Blue

        "indigo" ->
            Just Indigo

        "violet" ->
            Just Violet

        "black" ->
            Just Black

        "white" ->
            Just White

        "gray" ->
            Just Gray

        _ ->
            Nothing


{-| BREAK: Change `Orange` (the 2nd element) or `Gray` (the 10th element) to
`"gray"`.

One marked line near the start or the middle of a long list: You should see the
first line, and the lines around the marked line.

-}
allColors : List Color
allColors =
    [ Red
    , Orange
    , Yellow
    , Green
    , Blue
    , Indigo
    , Violet
    , Black
    , White
    , Gray
    , Red
    , Orange
    , Yellow
    , Green
    , Blue
    , Indigo
    , Violet
    , Black
    , White
    , Gray
    ]


{-| BREAK: Change `String.join ", "` to `String.length`.

The `^^^` is below the last line (the pipe), with a long list above it.

-}
allColorNames : String
allColorNames =
    [ colorName Red
    , colorName Orange
    , colorName Yellow
    , colorName Green
    , colorName Blue
    , colorName Indigo
    , colorName Violet
    , colorName Black
    , colorName White
    , colorName Gray
    , colorName Red
    , colorName Orange
    , colorName Yellow
    ]
        |> String.join ", "


{-| BREAK: Change `rotation = 0` to `rotation = "0"`.

The whole record is marked.

BREAK: Change `}.gap` to `}.gapp`.

The whole record is the region, but only the last line is marked (with `^`).

-}
defaultSettings : Settings
defaultSettings =
    { width = 100
    , height = 100
    , depth = 0
    , margin = 0
    , padding = 0
    , border = 0
    , radius = 0
    , opacity = 100
    , zIndex = 0
    , rotation = 0
    , scale = 1
    , blur = 0
    , shadow = 0
    , gap =
        { a = 1
        , b = 2
        , c = 3
        , d = 4
        , e = 5
        , f = 6
        , g = 7
        , h = 8
        , i = 9
        , j = 10
        , k = 11
        , l = 12
        , m = 13
        , gap = 8
        }.gap
    }


{-| BREAK: Change `String.repeat` to `String.append`.

The marked `case` (the 1st argument) is longer than what fits, so you should
see the line before it, and the start and the end of the `case`.

-}
separator : Color -> String
separator color =
    String.repeat
        (case color of
            Red ->
                1

            Orange ->
                2

            Yellow ->
                3

            Green ->
                4

            Blue ->
                5

            _ ->
                6
        )
        "-"


{-| BREAK: Remove the `String.fromInt` line.

The marked `if` (the left operand of `++`) is at the start, with a long right
operand after it.

-}
numberedColor : Int -> String
numberedColor n =
    String.fromInt
        (if n > 0 then
            n

         else
            0
        )
        ++ (case parseColor "red" of
                Just color ->
                    colorName color

                Nothing ->
                    "?"
           )
        ++ String.fromInt (colorNameLength Red)
        ++ allColorNames
        ++ separator Red
        ++ String.fromInt (List.length allColors)
        ++ String.fromInt defaultSettings.gap
        ++ String.fromInt defaultSettings.width
        ++ String.fromInt defaultSettings.height
        ++ String.fromInt defaultSettings.rotation
        ++ "."
