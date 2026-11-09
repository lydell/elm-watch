port module WorkerMain exposing (main)


port fromJs : (String -> msg) -> Sub msg


port toJs : Int -> Cmd msg


type Msg
    = GotMessageFromJs String


type alias Model =
    { messages : List String
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { messages = []
      }
    , toJs 0
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMessageFromJs message ->
            let
                duplicates =
                    model.messages
                        |> List.filter ((==) message)
                        |> List.length
            in
            ( { model | messages = message :: model.messages }
            , toJs duplicates
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    fromJs GotMessageFromJs


main : Program () Model Msg
main =
    Platform.worker
        { init = init
        , update = update
        , subscriptions = subscriptions
        }
