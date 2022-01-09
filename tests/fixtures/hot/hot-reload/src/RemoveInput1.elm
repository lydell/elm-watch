module RemoveInput1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events


type Msg
    = ButtonClicked


type alias Model =
    Int


init : Model
init =
    0


update : Msg -> Model -> Model
update msg model =
    case msg of
        ButtonClicked ->
            model + 1


view : Model -> Html Msg
view model =
    Html.div []
        [ Html.h1 [] [ Html.text "hot reload" ]
        , Html.button [ Html.Events.onClick ButtonClicked ] [ Html.text "Button" ]
        , Html.pre [] [ Html.text (String.fromInt model) ]
        ]


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , view = view
        , update = update
        }
