module HtmlMain exposing (main)

import Html exposing (Html)
import Html.Attributes as Attr


main : Html msg
main =
    Html.div
        [ Attr.style "position" "fixed"
        , Attr.style "top" "0"
        , Attr.style "right" "0"
        , Attr.style "bottom" "0"
        , Attr.style "left" "0"
        , Attr.style "display" "flex"
        , Attr.style "font-family" "sans-serif"
        ]
        [ Html.div
            [ Attr.style "margin" "auto"
            , Attr.style "border" "1px solid"
            , Attr.style "border-radius" "1em"
            , Attr.style "padding" "1em"
            ]
            [ Html.text "This page is just static HTML, rendered by Elm."
            ]
        ]
