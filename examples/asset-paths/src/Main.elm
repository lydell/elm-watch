module Main exposing (main)

import Assets
import Html exposing (Html)
import Html.Attributes as Attr


main : Html msg
main =
    Html.div []
        [ Html.img [ Attr.src Assets.logo, Attr.alt "Logo", Attr.width 100 ] []
        , Html.p []
            [ Html.img [ Attr.src Assets.iconsHeart, Attr.alt "Heart", Attr.width 24 ] []
            , Html.img [ Attr.src Assets.iconsStarFilled, Attr.alt "Star", Attr.width 24 ] []
            ]
        ]
