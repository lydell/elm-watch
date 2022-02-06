module Map1 exposing (main)

import Browser
import Html exposing (Html)
import Html.Events


type alias Model =
    Int


type Msg
    = Clicked Int -- | NewClicked Int


init : () -> ( Model, Cmd Msg )
init () =
    ( 0
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        -- NewClicked int ->
        --     ( model - int, Cmd.none )
        Clicked int ->
            ( model + int, Cmd.none )


view : Model -> Html Msg
view model =
    Html.main_ []
        [ Html.button [ Html.Events.onClick 1 ]
            [ Html.text ("Count: " ++ String.fromInt model) ]
            |> Html.map ((*) 2)
        ]
        |> Html.map Clicked


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = always Sub.none
        , view = view
        }
