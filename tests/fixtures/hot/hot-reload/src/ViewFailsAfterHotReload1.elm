module ViewFailsAfterHotReload1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events


type alias Model =
    Maybe Int


init : () -> ( Model, Cmd () )
init () =
    ( Nothing
    , Cmd.none
    )


view : Model -> Html ()
view model =
    Html.main_ [ Html.Events.onClick () ]
        [ Html.text
            (case model of
                Just value ->
                    String.fromInt value

                Nothing ->
                    "Nothing"
            )
        ]


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( Just 1337, Cmd.none )
        , subscriptions = always Sub.none
        , view = view
        }
