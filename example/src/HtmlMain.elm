module HtmlMain exposing (main)

import Html exposing (Html)
import Html.Attributes as Attr


main : Html msg
main =
    Html.div
        [ Attr.style "margin" "3em"
        , Attr.style "border" "1px solid"
        , Attr.style "border-radius" "1em"
        , Attr.style "padding" "1em"
        ]
        [ Html.text "This page is just static HTML, rendered by Elm."
        ]
