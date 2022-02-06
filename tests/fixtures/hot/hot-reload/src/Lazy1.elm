module Lazy1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events
import Html.Lazy


type alias Model =
    Int


init : () -> ( Model, Cmd () )
init () =
    ( 0
    , Cmd.none
    )


divisor =
    4


view : Model -> Html ()
view model =
    Html.main_ [ Html.Events.onClick () ]
        [ Html.p [] [ Html.text <| "Number: " ++ String.fromInt model ]
        , Html.Lazy.lazy viewLazy (model |> modBy divisor |> (==) 0)
        ]


viewLazy : Bool -> Html ()
viewLazy isDivisible =
    Html.p []
        [ Html.text <|
            "Is divisible by "
                ++ String.fromInt divisor
                ++ "? "
                ++ (if isDivisible |> Debug.log "ELM_LAZY_TEST isDivisible" then
                        "Yes."

                    else
                        "No."
                   )
        ]


main : Program () Model ()
main =
    Browser.element
        { init = init
        , update = \() model -> ( model + 1, Cmd.none )
        , subscriptions = always Sub.none
        , view = view
        }
