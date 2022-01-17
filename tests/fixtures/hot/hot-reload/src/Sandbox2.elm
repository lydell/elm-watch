module Sandbox2 exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes
import Html.Events


type Msg
    = OriginalButtonClicked
    | NewButtonClicked


type alias Model =
    { originalButtonClicked : Int
    , newButtonClicked : Int
    }


init : Model
init =
    { originalButtonClicked = 0
    , newButtonClicked = 0
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        OriginalButtonClicked ->
            { model | originalButtonClicked = model.originalButtonClicked + 1 }

        NewButtonClicked ->
            { model | newButtonClicked = model.newButtonClicked + 1 }


text =
    { probe = "After hot reload"
    }


view : Model -> Html Msg
view model =
    Html.div []
        [ Html.h1 [ Html.Attributes.class "probe" ] [ Html.text text.probe ]
        , Html.button [ Html.Events.onClick NewButtonClicked ] [ Html.text "Button" ]
        , Html.pre [] [ Html.text ("\n" ++ modelToString model ++ "\n") ]
        ]


modelToString : Model -> String
modelToString model =
    [ ( "originalButtonClicked", String.fromInt model.originalButtonClicked )
    , ( "newButtonClicked", String.fromInt model.newButtonClicked )
    ]
        |> List.map (\( key, value ) -> key ++ ": " ++ value)
        |> String.join "\n"


main : Program () Model Msg
main =
    Browser.sandbox
        { init = init
        , view = view
        , update = update
        }