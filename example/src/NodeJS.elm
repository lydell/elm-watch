port module NodeJS exposing (main)


port fromJs : (String -> msg) -> Sub msg


port toJs : ( String, Int ) -> Cmd msg


type Msg
    = GotMessageFromJs String


type alias Model =
    { count : Int
    }


init : () -> ( Model, Cmd Msg )
init () =
    ( { count = 0
      }
    , Cmd.none
      -- For testing adding a Cmd to init (should need a full reload):
      -- toJs ( "Init message!", 1337 )
    )


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotMessageFromJs message ->
            let
                count =
                    model.count + 1
            in
            ( { model | count = count }
            , toJs ( String.toUpper message ++ "!", count )
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
