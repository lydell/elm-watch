port module Worker2 exposing (main)


port toJs : String -> Cmd msg


port fromJs : (Int -> msg) -> Sub msg


type Msg
    = OriginalFromJs Int
    | NewFromJs Int


type alias Model =
    { originalFromJs : List Int
    , newFromJs : List Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { originalFromJs = []
      , newFromJs = []
      }
    , Cmd.none
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        OriginalFromJs int ->
            let
                newValue =
                    int :: model.originalFromJs
            in
            ( { model | originalFromJs = newValue }
            , toJs ("Before hot reload: " ++ fromJsToString newValue)
            )

        NewFromJs int ->
            let
                newValue =
                    int :: model.newFromJs
            in
            ( { model | newFromJs = newValue }
            , toJs ("Before: " ++ fromJsToString model.originalFromJs ++ ". After hot reload: " ++ fromJsToString newValue)
            )


subscriptions : Model -> Sub Msg
subscriptions model =
    fromJs NewFromJs


fromJsToString : List Int -> String
fromJsToString list =
    let
        content =
            list |> List.reverse |> List.map String.fromInt |> String.join ", "
    in
    "[" ++ content ++ "]"


main : Program () Model Msg
main =
    Platform.worker
        { init = init
        , update = update
        , subscriptions = subscriptions
        }
