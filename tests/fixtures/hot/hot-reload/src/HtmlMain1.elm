module HtmlMain1 exposing (main)

import Html exposing (Html)
import Html.Attributes


main : Html msg
main =
    Html.h1 [ Html.Attributes.class "probe" ] [ Html.text "hot reload" ]
