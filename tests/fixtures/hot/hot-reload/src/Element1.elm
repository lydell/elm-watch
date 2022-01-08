port module Element1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Attributes
import Html.Events


port toJs : Int -> Cmd msg


port fromJs : (Int -> msg) -> Sub msg


port terminate : (() -> msg) -> Sub msg


type Msg
    = OriginalButtonClicked
    | OriginalFromJs Int
    | Terminate


type alias Model =
    { browserOnClick : Int
    , originalButtonClicked : Int
    , newButtonClicked : Int
    , originalFromJs : List Int
    , newFromJs : List Int
    , terminated : Bool
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { browserOnClick = 0
      , originalButtonClicked = 0
      , newButtonClicked = 0
      , originalFromJs = []
      , newFromJs = []
      , terminated = False
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OriginalButtonClicked ->
            ( { model | originalButtonClicked = model.originalButtonClicked + 1 }, Cmd.none )

        OriginalFromJs int ->
            ( { model | originalFromJs = int :: model.originalFromJs }, toJs (int * 2) )

        Terminate ->
            ( { model | terminated = True }, Cmd.none )


subscriptions : Model -> Sub Msg
subscriptions model =
    if model.terminated then
        Sub.none

    else
        Sub.batch
            [ fromJs OriginalFromJs
            , terminate (\() -> Terminate)
            ]


view : Model -> Html Msg
view model =
    Html.div []
        [ Html.h1 [ Html.Attributes.class "probe" ] [ Html.text "Before hot reload" ]
        , Html.button [ Html.Events.onClick OriginalButtonClicked ] [ Html.text "Button" ]
        , Html.pre [] [ Html.text ("\n" ++ modelToString model ++ "\n") ]
        ]


modelToString : Model -> String
modelToString model =
    [ ( "browserOnClick", String.fromInt model.browserOnClick )
    , ( "originalButtonClicked", String.fromInt model.originalButtonClicked )
    , ( "newButtonClicked", String.fromInt model.newButtonClicked )
    , ( "originalFromJs", fromJsToString model.originalFromJs )
    , ( "newFromJs", fromJsToString model.newFromJs )
    ]
        |> List.map (\( key, value ) -> key ++ ": " ++ value)
        |> String.join "\n"


fromJsToString : List Int -> String
fromJsToString list =
    let
        content =
            list |> List.map String.fromInt |> String.join ", "
    in
    "[" ++ content ++ "]"


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , view = view
        , update = update
        , subscriptions = subscriptions
        }
